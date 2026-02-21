/**
 * AGENTS.md generator — writes user context snapshot
 *
 * Queries preferences, facts, patterns, and top entities from Postgres,
 * formats into markdown within the token budget, writes to ./AGENTS.md.
 * Called after every afterAgent hook and on startup.
 */

import { writeFile } from "fs/promises";
import { getSettingsSync, getItemsByType, getTopEntities } from "@edda/db";

export async function generateAgentsMd(): Promise<void> {
  const settings = getSettingsSync();

  const [preferences, facts, patterns, entities] = await Promise.all([
    getItemsByType("preference", "active"),
    getItemsByType("learned_fact", "active"),
    getItemsByType("pattern", "active"),
    getTopEntities(settings.agents_md_max_entities),
  ]);

  const maxPerCategory = settings.agents_md_max_per_category;

  const sections: string[] = [];

  if (preferences.length > 0) {
    const items = preferences.slice(0, maxPerCategory);
    sections.push(
      `## Preferences\n${items.map((p) => `- ${p.content}`).join("\n")}`,
    );
  }

  if (facts.length > 0) {
    const items = facts.slice(0, maxPerCategory);
    sections.push(
      `## Known Facts\n${items.map((f) => `- ${f.content}`).join("\n")}`,
    );
  }

  if (patterns.length > 0) {
    const items = patterns.slice(0, maxPerCategory);
    sections.push(
      `## Patterns\n${items.map((p) => `- ${p.content}`).join("\n")}`,
    );
  }

  if (entities.length > 0) {
    sections.push(
      `## Key People & Projects\n${entities.map((e) => `- **${e.name}** (${e.type}) — mentioned ${e.mention_count}x`).join("\n")}`,
    );
  }

  const content = sections.join("\n\n");

  // TODO: Token budget enforcement — truncate if over agents_md_token_budget

  await writeFile("./AGENTS.md", content, "utf-8");
}
