/**
 * Skill loader — reads SKILL.md content and metadata from disk by skill name.
 * Caches on first read to avoid repeated fs access.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, "../../skills");

const SAFE_SKILL_NAME = /^[a-zA-Z0-9_-]+$/;

export interface SkillMetadata {
  content: string;
  allowedTools: string[];
}

const _cache = new Map<string, SkillMetadata>();

/** Parse allowed-tools list from YAML frontmatter. */
function parseAllowedTools(raw: string): string[] {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  const lines = fmMatch[1].split("\n");
  const idx = lines.findIndex((l) => l.startsWith("allowed-tools:"));
  if (idx === -1) return [];

  const tools: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+)$/);
    if (m) tools.push(m[1].trim());
    else if (lines[i].trim()) break; // Next YAML key
  }
  return tools;
}

function loadAndParse(skillName: string): SkillMetadata {
  if (_cache.has(skillName)) return _cache.get(skillName)!;
  if (!SAFE_SKILL_NAME.test(skillName)) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
  const path = join(SKILLS_DIR, skillName, "SKILL.md");
  const content = readFileSync(path, "utf-8");
  const allowedTools = parseAllowedTools(content);
  const meta = { content, allowedTools };
  _cache.set(skillName, meta);
  return meta;
}

/** Load SKILL.md content by skill name. Caches on first read. */
export function loadSkillContent(skillName: string): string {
  return loadAndParse(skillName).content;
}

/**
 * Collect the union of allowed-tools from multiple skills.
 * Returns an empty set if no skills declare allowed-tools (meaning no restriction).
 */
export function collectSkillTools(skillNames: string[]): Set<string> {
  const tools = new Set<string>();
  let anyDeclared = false;
  for (const name of skillNames) {
    const meta = loadAndParse(name);
    if (meta.allowedTools.length > 0) {
      anyDeclared = true;
      for (const t of meta.allowedTools) tools.add(t);
    }
  }
  // If no skill declared allowed-tools, return empty set (meaning "all tools")
  return anyDeclared ? tools : new Set();
}
