/**
 * Tool: install_skill — Persist a skill from skillfish CLI output into the DB.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { upsertSkill, getSkillByName } from "@edda/db";
import { parseFrontmatter, writeSkillsToStore } from "../skill-utils.js";
import { getStore } from "../../store.js";

const MAX_CONTENT_SIZE = 50 * 1024; // 50KB
const MAX_FILES = 20;
const MAX_FILE_SIZE = 256 * 1024; // 256KB per file

/** Positive-match: relative path segments, no traversal, no null bytes. */
const VALID_FILE_PATH = /^[\w][\w./ -]{0,199}$/;

export const installSkillSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(MAX_CONTENT_SIZE)
    .describe("Raw SKILL.md content including YAML frontmatter"),
  files: z
    .record(z.string().max(MAX_FILE_SIZE))
    .optional()
    .default({})
    .describe("Companion files: { 'relative/path': 'content' }. Max 20 files, 256KB each."),
});

export const installSkillTool = tool(
  async ({ content, files }) => {
    // 1. Parse frontmatter
    const { name, description } = parseFrontmatter(content);
    if (!name) {
      throw new Error("SKILL.md frontmatter must include a 'name' field.");
    }

    // 2. Validate name format (snake_case, 1-50 chars)
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(name)) {
      throw new Error(
        `Invalid skill name '${name}'. Must be snake_case (lowercase letters, digits, underscores), start with a letter, max 50 chars.`,
      );
    }

    // 3. Validate files
    const fileKeys = Object.keys(files);
    if (fileKeys.length > MAX_FILES) {
      throw new Error(`Too many companion files (${fileKeys.length}). Maximum is ${MAX_FILES}.`);
    }

    for (const key of fileKeys) {
      if (
        !key ||
        key.includes("..") ||
        key.includes("\\") ||
        key.includes("\0") ||
        key.startsWith("/") ||
        key.endsWith("/") ||
        key === "SKILL.md" ||
        !VALID_FILE_PATH.test(key)
      ) {
        throw new Error(
          `Invalid file path '${key}'. Paths must be relative, cannot contain '..', and cannot be 'SKILL.md'.`,
        );
      }
    }

    // 4. System skill protection — reject overwriting system skills
    const existing = await getSkillByName(name);
    if (existing?.is_system) {
      throw new Error(`Cannot overwrite system skill '${name}'.`);
    }

    // 5. Upsert to DB (overwrites existing user skills, creates new otherwise)
    const skill = await upsertSkill({
      name,
      description,
      content,
      files,
      is_system: false,
      created_by: "install_skill",
    });

    // 6. Sync to store for progressive disclosure
    try {
      const store = await getStore();
      await writeSkillsToStore([skill], store);
    } catch (storeErr) {
      throw new Error(
        `Skill '${name}' was saved to the database (version ${skill.version}) ` +
          `but failed to sync to the agent store. It will become visible after the next restart. ` +
          `Store error: ${storeErr instanceof Error ? storeErr.message : String(storeErr)}`,
      );
    }

    return JSON.stringify({
      installed: true,
      name: skill.name,
      version: skill.version,
      ...(existing ? { updated: true } : {}),
    });
  },
  {
    name: "install_skill",
    description:
      "Install a skill from skillfish CLI output into the database. " +
      "Pass the raw SKILL.md content and optional companion files. " +
      "Overwrites existing user skills with the same name. " +
      "Use update_agent to assign the installed skill to an agent.",
    schema: installSkillSchema,
  },
);
