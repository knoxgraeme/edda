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

/**
 * Parse allowed-tools from YAML frontmatter.
 * Handles both list format (- tool_name) and space-delimited format.
 */
function parseAllowedTools(raw: string): string[] {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  const frontmatter = fmMatch[1];
  const toolsMatch = frontmatter.match(/^allowed-tools:\s*$/m);
  if (!toolsMatch) {
    // Check inline format: allowed-tools: tool1 tool2
    const inlineMatch = frontmatter.match(/^allowed-tools:\s*(.+)$/m);
    if (inlineMatch) {
      return inlineMatch[1].split(/\s+/).filter(Boolean);
    }
    return [];
  }

  // Parse YAML list items after "allowed-tools:"
  const afterKey = frontmatter.slice(toolsMatch.index! + toolsMatch[0].length);
  const tools: string[] = [];
  for (const line of afterKey.split("\n")) {
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch) {
      tools.push(itemMatch[1].trim());
    } else if (line.trim() && !line.match(/^\s+-/)) {
      break; // Next YAML key
    }
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

/** Load SKILL.md metadata including allowed-tools. Caches on first read. */
export function loadSkillMetadata(skillName: string): SkillMetadata {
  return loadAndParse(skillName);
}

/**
 * Collect the union of allowed-tools from multiple skills.
 * Returns an empty set if no skills declare allowed-tools (meaning no restriction).
 */
export function collectSkillTools(skillNames: string[]): Set<string> {
  const tools = new Set<string>();
  let anyDeclared = false;
  for (const name of skillNames) {
    try {
      const meta = loadAndParse(name);
      if (meta.allowedTools.length > 0) {
        anyDeclared = true;
        for (const t of meta.allowedTools) tools.add(t);
      }
    } catch {
      // Skill not found — skip (error logged by caller)
    }
  }
  // If no skill declared allowed-tools, return empty set (meaning "all tools")
  return anyDeclared ? tools : new Set();
}
