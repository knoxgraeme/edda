/**
 * Seed system skills from SKILL.md files on disk.
 *
 * Reads each skills/{name}/SKILL.md, parses YAML frontmatter,
 * and upserts into the skills table. Idempotent — only bumps
 * version when content actually changes.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { upsertSkill } from "@edda/db";
import { getStore } from "../store/index.js";
import { getLogger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "../../skills");

function parseFrontmatter(raw: string): { name: string; description: string } {
  const parts = raw.split("---");
  if (parts.length < 3) {
    throw new Error("SKILL.md missing YAML frontmatter");
  }
  const yaml = parts[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/description:\s*>\s*\n([\s\S]*?)(?=\n\w|\n---)/);
  const descInline = yaml.match(/^description:\s*(?!>)(.+)$/m);

  const name = nameMatch?.[1]?.trim() ?? "";
  let description = "";
  if (descMatch) {
    description = descMatch[1].replace(/\n\s*/g, " ").trim();
  } else if (descInline) {
    description = descInline[1].trim();
  }

  return { name, description };
}

export async function seedSkills(): Promise<void> {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());
  const store = await getStore();

  const results = await Promise.allSettled(
    dirs.map(async (dir) => {
      const skillPath = join(SKILLS_DIR, dir.name, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillPath, "utf-8");
      } catch {
        return; // skip directories without SKILL.md
      }

      const { name, description } = parseFrontmatter(raw);
      if (!name) {
        getLogger().warn({ skill: dir.name }, "Skipping skill — no name in frontmatter");
        return;
      }

      await upsertSkill({ name, description, content: raw, is_system: true, created_by: "seed" });

      // Sync to PostgresStore for agent reads via SkillsMiddleware
      const now = new Date().toISOString();
      await store.put(["filesystem"], `/skills/${dir.name}/SKILL.md`, {
        content: raw.split("\n"),
        created_at: now,
        modified_at: now,
      });
    }),
  );

  for (const r of results) {
    if (r.status === "rejected") {
      getLogger().error({ err: r.reason }, "Failed to seed skill");
    }
  }
}
