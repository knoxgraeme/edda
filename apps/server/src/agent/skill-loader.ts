/**
 * Skill loader — reads SKILL.md content from disk by skill name.
 * Caches on first read to avoid repeated fs access.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, "../../skills");

const SAFE_SKILL_NAME = /^[a-zA-Z0-9_-]+$/;
const _cache = new Map<string, string>();

/** Load SKILL.md content by skill name. Caches on first read. */
export function loadSkillContent(skillName: string): string {
  if (_cache.has(skillName)) return _cache.get(skillName)!;
  if (!SAFE_SKILL_NAME.test(skillName)) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
  const path = join(SKILLS_DIR, skillName, "SKILL.md");
  const content = readFileSync(path, "utf-8");
  _cache.set(skillName, content);
  return content;
}
