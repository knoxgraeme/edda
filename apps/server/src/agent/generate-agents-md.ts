/**
 * AGENTS.md generator — deterministic template builder and diff logic
 *
 * Builds a deterministic template from DB data and computes diffs.
 * Used by the get_context_diff and save_agents_md tools.
 * The curated content lives in the agents_md_versions table (no filesystem I/O).
 */

import { createHash } from "node:crypto";
import {
  getSettingsSync,
  getItemsByType,
  getTopEntities,
  getItemTypes,
  getPendingConfirmationsCount,
  getAllLists,
} from "@edda/db";
import type { ItemType } from "@edda/db";

// ── Helpers ──────────────────────────────────────────────────────

/** SHA-256 hex hash of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ── Deterministic template builder ──────────────────────────────

/**
 * Build the deterministic template from DB queries.
 * This is a free (no LLM) snapshot of all raw user data that goes into AGENTS.md.
 * Returns the template string and its SHA-256 hash.
 */
export async function buildDeterministicTemplate(): Promise<{
  template: string;
  hash: string;
}> {
  const settings = getSettingsSync();

  const [preferences, facts, patterns, entities, itemTypes, pendingCount, lists] = await Promise.all([
    getItemsByType("preference", "active"),
    getItemsByType("learned_fact", "active"),
    getItemsByType("pattern", "active"),
    getTopEntities(settings.agents_md_max_entities),
    getItemTypes(),
    getPendingConfirmationsCount(),
    getAllLists({ status: 'active' }),
  ]);

  const maxPerCategory = settings.agents_md_max_per_category;
  const sections: string[] = [];

  // Header
  const headerParts = ["# Raw Template Data"];
  if (settings.user_display_name) {
    headerParts.push(`\nUser: ${settings.user_display_name}`);
  }
  headerParts.push(`\nTimezone: ${settings.user_timezone}`);
  if (pendingCount > 0) {
    headerParts.push(`\nPending confirmations: ${pendingCount}`);
  }
  sections.push(headerParts.join(""));

  // Preferences
  if (preferences.length > 0) {
    const items = preferences.slice(0, maxPerCategory);
    sections.push(`## Preferences\n${items.map((p) => `- ${p.content}`).join("\n")}`);
  }

  // Facts
  if (facts.length > 0) {
    const items = facts.slice(0, maxPerCategory);
    sections.push(`## Known Facts\n${items.map((f) => `- ${f.content}`).join("\n")}`);
  }

  // Patterns
  if (patterns.length > 0) {
    const items = patterns.slice(0, maxPerCategory);
    sections.push(`## Patterns\n${items.map((p) => `- ${p.content}`).join("\n")}`);
  }

  // Entities
  if (entities.length > 0) {
    sections.push(
      `## Key Entities\n${entities
        .map((e) => {
          const desc = e.description ? ` — ${e.description}` : "";
          return `- **${e.name}** (${e.type})${desc} [${e.mention_count}x]`;
        })
        .join("\n")}`,
    );
  }

  // Active lists
  if (lists.length > 0) {
    sections.push(
      `## Active Lists\n` +
      lists.map(l => `- ${l.icon} **${l.name}** (${l.list_type}, ${l.item_count} items)` +
        (l.summary ? `\n  ${l.summary}` : '')
      ).join("\n")
    );
  }

  // Item types (non-agent-internal)
  const userTypes = itemTypes.filter((t: ItemType) => !t.agent_internal);
  if (userTypes.length > 0) {
    const typeLines = userTypes.map((t: ItemType) => {
      const meta =
        Object.keys(t.metadata_schema).length > 0
          ? ` | metadata: ${JSON.stringify(t.metadata_schema)}`
          : "";
      return `- ${t.icon} **${t.name}**: ${t.classification_hint}${meta}`;
    });
    sections.push(`## Item Types\n${typeLines.join("\n")}`);
  }

  // Settings context
  sections.push(
    `## Settings\n` +
      `- Approval (new type): ${settings.approval_new_type}\n` +
      `- Approval (archive stale): ${settings.approval_archive_stale}\n` +
      `- Approval (entity merge): ${settings.approval_merge_entity}\n` +
      `- Token budget: ${settings.agents_md_token_budget}`,
  );

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
