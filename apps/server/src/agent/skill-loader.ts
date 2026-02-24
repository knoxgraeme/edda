/**
 * Skill loader — reads SKILL.md content from disk by skill name.
 * Caches on first read to avoid repeated fs access.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "../../skills");

const _cache = new Map<string, string>();

/** Load SKILL.md content by skill name. Caches on first read. */
export function loadSkillContent(skillName: string): string {
  if (_cache.has(skillName)) return _cache.get(skillName)!;
  const path = join(SKILLS_DIR, skillName, "SKILL.md");
  const content = readFileSync(path, "utf-8");
  _cache.set(skillName, content);
  return content;
}
