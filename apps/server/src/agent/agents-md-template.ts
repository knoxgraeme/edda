/**
 * AGENTS.md change signal builder and diff logic.
 *
 * Builds a deterministic snapshot of raw user data from DB queries.
 * Used by the get_context_diff tool to detect when new data is available
 * that the context_refresh skill should consider incorporating into
 * the agent's procedural memory (AGENTS.md).
 *
 * The snapshot is NOT the same as AGENTS.md — it's an input signal.
 * AGENTS.md is curated procedural memory (communication, patterns,
 * standards, corrections) maintained by the agent itself.
 */

import { createHash } from "node:crypto";
import {
  getSettingsSync,
  getItemsByType,
  getTopEntities,
} from "@edda/db";

// ── Helpers ──────────────────────────────────────────────────────

/** SHA-256 hex hash of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ── Change signal builder ────────────────────────────────────────

/**
 * Build a deterministic snapshot of raw user data from DB queries.
 *
 * This is a free (no LLM) snapshot of user knowledge that serves as
 * a change signal. When this snapshot's hash changes, it means new
 * preferences, facts, patterns, or entities have been added/removed,
 * and the context_refresh skill should review them.
 *
 * Does NOT include item types, lists, or settings — those are in the
 * deterministic system prompt and don't belong in AGENTS.md.
 */
export async function buildDeterministicTemplate(): Promise<{
  template: string;
  hash: string;
}> {
  const settings = getSettingsSync();

  const [preferences, facts, patterns, entities] = await Promise.all([
    getItemsByType("preference", "active"),
    getItemsByType("learned_fact", "active"),
    getItemsByType("pattern", "active"),
    getTopEntities(settings.agents_md_max_entities),
  ]);

  const maxPerCategory = settings.agents_md_max_per_category;
  const sections: string[] = [];

  // Header
  sections.push("# Change Signal");

  // Preferences
  if (preferences.length > 0) {
    const items = preferences.slice(0, maxPerCategory);
    sections.push(`## Preferences (${preferences.length} total)\n${items.map((p) => `- ${p.content}`).join("\n")}`);
  }

  // Facts
  if (facts.length > 0) {
    const items = facts.slice(0, maxPerCategory);
    sections.push(`## Known Facts (${facts.length} total)\n${items.map((f) => `- ${f.content}`).join("\n")}`);
  }

  // Patterns
  if (patterns.length > 0) {
    const items = patterns.slice(0, maxPerCategory);
    sections.push(`## Patterns (${patterns.length} total)\n${items.map((p) => `- ${p.content}`).join("\n")}`);
  }

  // Entities
  if (entities.length > 0) {
    sections.push(
      `## Key Entities (${entities.length} total)\n${entities
        .map((e) => {
          const desc = e.description ? ` — ${e.description}` : "";
          return `- **${e.name}** (${e.type})${desc} [${e.mention_count}x]`;
        })
        .join("\n")}`,
    );
  }

  const template = sections.join("\n\n") + "\n";
  return { template, hash: sha256(template) };
}

// ── Diff builder ────────────────────────────────────────────────

/**
 * Build a human-readable diff between two template strings.
 * Shows added (+), removed (-), and context lines.
 */
export function buildTemplateDiff(oldTemplate: string, newTemplate: string): string {
  const oldLines = oldTemplate.split("\n");
  const newLines = newTemplate.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const diff: string[] = [];

  // Lines removed (in old but not in new)
  for (const line of oldLines) {
    if (!newSet.has(line) && line.trim()) {
      diff.push(`- ${line}`);
    }
  }

  // Lines added (in new but not in old)
  for (const line of newLines) {
    if (!oldSet.has(line) && line.trim()) {
      diff.push(`+ ${line}`);
    }
  }

  return diff.length > 0 ? diff.join("\n") : "(no changes)";
}
