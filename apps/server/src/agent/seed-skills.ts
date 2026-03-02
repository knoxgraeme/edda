/**
 * Seed system skills from SKILL.md files on disk.
 *
 * Reads each skills/{name}/SKILL.md, parses YAML frontmatter,
 * and upserts into the skills table. Idempotent — only bumps
 * version when content actually changes.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { upsertSkill } from "@edda/db";
import { getStore } from "../store.js";
import { parseFrontmatter, writeSkillsToStore } from "./skill-utils.js";
import { getLogger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "../../skills");


const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".bz2",
  ".pdf", ".doc", ".docx",
  ".mp3", ".mp4", ".wav", ".avi",
  ".exe", ".dll", ".so", ".dylib",
]);

const MAX_FILE_SIZE = 256 * 1024; // 256KB per file
const MAX_TOTAL_SIZE = 1024 * 1024; // 1MB aggregate per skill

/**
 * Recursively read all non-SKILL.md, non-binary, non-dotfile entries
 * in a skill directory and return them as { "relative/path": "content" }
 * with keys sorted for deterministic JSONB serialization.
 */
async function walkDir(
  base: string,
  current: string = base,
  state: { totalSize: number } = { totalSize: 0 },
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = join(current, entry.name);

    if (entry.isDirectory()) {
      Object.assign(files, await walkDir(base, full, state));
    } else if (entry.isFile()) {
      if (entry.name === "SKILL.md") continue;
      const ext = extname(entry.name).toLowerCase();
      if (ext && BINARY_EXTENSIONS.has(ext)) continue;
      const info = await stat(full);
      if (info.size > MAX_FILE_SIZE) continue;
      if (state.totalSize + info.size > MAX_TOTAL_SIZE) {
        getLogger().warn({ skill: base }, "Skipping remaining files — aggregate size limit reached");
        break;
      }
      state.totalSize += info.size;
      const relPath = relative(base, full);
      files[relPath] = await readFile(full, "utf-8");
    }
  }

  // Sort keys at the top level for deterministic JSONB output
  if (current === base) {
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(files).sort()) {
      sorted[key] = files[key];
    }
    return sorted;
  }
  return files;
}

export async function seedSkills(): Promise<void> {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());
  const store = await getStore();

  const results = await Promise.allSettled(
    dirs.map(async (dir) => {
      const skillDir = join(SKILLS_DIR, dir.name);
      const skillPath = join(skillDir, "SKILL.md");
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

      const files = await walkDir(skillDir);

      const skill = await upsertSkill({
        name,
        description,
        content: raw,
        files,
        is_system: true,
        created_by: "seed",
      });

      // Sync to PostgresStore for agent reads via SkillsMiddleware
      await writeSkillsToStore([skill], store);
    }),
  );

  for (const r of results) {
    if (r.status === "rejected") {
      getLogger().error({ err: r.reason }, "Failed to seed skill");
    }
  }
}
