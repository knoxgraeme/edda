/**
 * Shared skill utilities — parseFrontmatter and writeSkillsToStore.
 *
 * Extracted so both seed-skills and install-skill can reuse them
 * without importing from build-agent.ts.
 */

import type { BaseStore } from "@langchain/langgraph";
import type { Skill } from "@edda/db";

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Extracts name and description fields.
 */
export function parseFrontmatter(raw: string): { name: string; description: string } {
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

/**
 * Write pre-fetched skills into the PostgresStore for deepagents
 * progressive disclosure. Skills are fetched once in buildAgent() and
 * shared with both collectFromSkills() (tool scoping) and this function.
 *
 * INVARIANT: Callers that persist skills via upsertSkill() must also call
 * this function to keep the DB and LangGraph store in sync.
 */
export async function writeSkillsToStore(skills: Skill[], store: BaseStore): Promise<void> {
  if (skills.length === 0) return;

  const now = new Date().toISOString();
  const writes: Promise<void>[] = [];

  for (const s of skills) {
    if (s.content) {
      writes.push(
        store.put(["filesystem"], `/skills/${s.name}/SKILL.md`, {
          content: s.content.split("\n"),
          created_at: now,
          modified_at: now,
        }),
      );
    }
    for (const [relPath, content] of Object.entries(s.files)) {
      writes.push(
        store.put(["filesystem"], `/skills/${s.name}/${relPath}`, {
          content: content.split("\n"),
          created_at: now,
          modified_at: now,
        }),
      );
    }
  }

  await Promise.all(writes);
}
