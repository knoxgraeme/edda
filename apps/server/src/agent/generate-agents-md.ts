/**
 * AGENTS.md generator — DB-backed versioned user context
 *
 * Builds a deterministic template from DB data, diffs against the previous
 * version, and spawns a subagent to make surgical edits. The curated content
 * lives in the agents_md_versions table (no filesystem I/O).
 *
 * Two entry points:
 * - maybeRefreshAgentsMd() — called inline from post-process; stores template + hash only
 * - runContextRefreshAgent() — called by cron; spawns subagent to curate content
 */

import { createHash } from "node:crypto";
import {
  getSettingsSync,
  getItemsByType,
  getTopEntities,
  getItemTypes,
  getPendingConfirmationsCount,
  getLatestAgentsMd,
  saveAgentsMdVersion,
  pruneAgentsMdVersions,
  createAgentLog,
  getRecentTaskRuns,
} from "@edda/db";
import type { AgentDefinition, ItemType } from "@edda/db";
import { getStore } from "../store/index.js";
import { ENTITY_TYPE_TO_DIR, entityToMemoryKey } from "./memory-paths.js";
import type { AIMessageChunk } from "@langchain/core/messages";
import { getChatModel } from "../llm/index.js";
import { saveAgentsMdTool, saveAgentsMdSchema } from "./tools/save-agents-md.js";

// ── Helpers ──────────────────────────────────────────────────────

/** Rough token estimate: 1 token ≈ 4 characters */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** SHA-256 hex hash of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ── In-memory hash cache (avoids DB queries when nothing changed) ───
let _cachedHash: string | null = null;
let _cachedHashAt = 0;
const HASH_CACHE_TTL_MS = 30_000; // 30 seconds

/** Reset hash cache — exported for testing only. */
export function _resetHashCache(): void {
  _cachedHash = null;
  _cachedHashAt = 0;
}

// ── Memory file helpers ──────────────────────────────────────────

/**
 * Query PostgresStore for existing memory file keys.
 * Returns a Set of keys like "/people/sarah", "/projects/atlas".
 */
async function getMemoryFilePaths(): Promise<Set<string>> {
  try {
    const store = await getStore();
    // Fetch all filesystem items; 200 covers typical usage (memory files + skills).
    // If the limit is hit, some memory pointers may be missing from the template.
    const results = await store.search(["filesystem"], { limit: 200 });
    const prefixes = Object.values(ENTITY_TYPE_TO_DIR).map((d) => `/${d}/`);
    return new Set(
      results
        .filter((item) => prefixes.some((p) => item.key.startsWith(p)))
        .map((item) => item.key),
    );
  } catch (err) {
    // Store may not be initialized yet (e.g. during tests or first startup)
    console.warn("[getMemoryFilePaths] Failed to query store, falling back to empty set:", err);
    return new Set();
  }
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

  const [preferences, facts, patterns, entities, itemTypes, pendingCount, memoryPaths] =
    await Promise.all([
      getItemsByType("preference", "active"),
      getItemsByType("learned_fact", "active"),
      getItemsByType("pattern", "active"),
      getTopEntities(settings.agents_md_max_entities),
      getItemTypes(),
      getPendingConfirmationsCount(),
      getMemoryFilePaths(),
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

  // Entities — annotate with /memories/ pointers when a memory file exists
  if (entities.length > 0) {
    sections.push(
      `## Key Entities\n${entities
        .map((e) => {
          const memKey = entityToMemoryKey(e.name, e.type);
          const hasMemory = memKey && memoryPaths.has(memKey);
          const desc = e.description ? ` — ${e.description}` : "";
          const pointer = hasMemory ? ` → /memories${memKey}` : "";
          return `- **${e.name}** (${e.type})${desc}${pointer} [${e.mention_count}x]`;
        })
        .join("\n")}`,
    );
  }

  // Item types (non-agent-internal)
  const userTypes = itemTypes.filter((t: ItemType) => !t.agent_internal);
  if (userTypes.length > 0) {
    const typeLines = userTypes.map((t: ItemType) => {
      const meta = Object.keys(t.metadata_schema).length > 0
        ? ` | metadata: ${JSON.stringify(t.metadata_schema)}`
        : "";
      const hint = t.extraction_hint ? ` | extract: ${t.extraction_hint}` : "";
      return `- ${t.icon} **${t.name}**: ${t.classification_hint}${meta}${hint}`;
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

// ── Post-process entry point ────────────────────────────────────

/**
 * Called from post-process middleware (replaces old generateAgentsMd).
 * Fast — no LLM call. Only stores the latest template + hash so the
 * cron job can compute a diff on its next run.
 */
export async function maybeRefreshAgentsMd(): Promise<void> {
  if (_cachedHash && Date.now() - _cachedHashAt < HASH_CACHE_TTL_MS) return;

  const { template, hash } = await buildDeterministicTemplate();
  const latest = await getLatestAgentsMd();

  // If hash matches, nothing changed — skip
  if (latest?.input_hash === hash) {
    _cachedHash = hash;
    _cachedHashAt = Date.now();
    return;
  }

  // Store updated template + hash, preserve existing content
  const currentContent = latest?.content ?? "";
  await saveAgentsMdVersion({ content: currentContent, template, inputHash: hash });
  _cachedHash = hash;
  _cachedHashAt = Date.now();
}

// ── Cron entry point: subagent curation ─────────────────────────

/**
 * Spawn a subagent to curate AGENTS.md based on what changed.
 * Called by the context_refresh cron job.
 */
export async function runContextRefreshAgent(): Promise<void> {
  const startTime = Date.now();
  const settings = getSettingsSync();

  try {
    // 1. Build current template + hash
    const { template, hash } = await buildDeterministicTemplate();
    const latest = await getLatestAgentsMd();
    const currentContent = latest?.content ?? "";
    const previousTemplate = latest?.template ?? "";

    // 2. Skip if nothing changed
    if (latest?.input_hash === hash) {
      console.log("  [context_refresh] No changes detected, skipping");
      return;
    }

    // 3. Compute diff
    const diff = buildTemplateDiff(previousTemplate, template);
    if (diff === "(no changes)") {
      console.log("  [context_refresh] Diff is empty, skipping");
      return;
    }

    // 4. Build subagent prompt
    const tokenBudget = settings.agents_md_token_budget;
    const systemPrompt = buildSubagentPrompt(currentContent, diff, template, tokenBudget);

    // 5. Spawn subagent with tool binding
    const model = await getChatModel(settings.context_refresh_model);
    if (!model.bindTools) {
      throw new Error(
        `Model "${settings.context_refresh_model}" does not support tool binding. ` +
        `context_refresh requires a model that implements bindTools().`,
      );
    }
    const modelWithTools = model.bindTools([saveAgentsMdTool]);

    const result = await modelWithTools.invoke([
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content:
          "Review the changes and edit the AGENTS.md document accordingly. " +
          "Save your edited version using the save_agents_md tool.",
      },
    ]);

    // 6. Extract tool call, validate, and save
    const toolCalls = (result as AIMessageChunk).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const saveCall = toolCalls.find((tc) => tc.name === "save_agents_md");
      if (saveCall) {
        const parsed = saveAgentsMdSchema.safeParse(saveCall.args);
        if (parsed.success) {
          await saveAgentsMdVersion({ content: parsed.data.content, template, inputHash: hash });
        } else {
          console.error("  [context_refresh] Invalid tool call args:", parsed.error.message);
        }
      }
    }

    // 7. Prune old versions
    await pruneAgentsMdVersions(settings.agents_md_max_versions);

    // 8. Log success
    const durationMs = Date.now() - startTime;
    await createAgentLog({
      skill: "context_refresh",
      trigger: "system_cron",
      input_summary: `Template hash: ${hash.slice(0, 12)}…, diff lines: ${diff.split("\n").length}`,
      output_summary: `AGENTS.md updated (${estimateTokens(currentContent)} → new version)`,
      model: settings.context_refresh_model,
      duration_ms: durationMs,
    });

    console.log(`  [context_refresh] AGENTS.md updated in ${durationMs}ms`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("  [context_refresh] Failed:", err);

    await createAgentLog({
      skill: "context_refresh",
      trigger: "system_cron",
      output_summary: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      duration_ms: durationMs,
    }).catch(() => {});
  }
}

// ── Per-agent context (channel agents) ──────────────────────────

/**
 * Build a lightweight context template for a channel agent from its recent task runs.
 * No LLM call — purely deterministic.
 */
export async function buildAgentTemplate(definition: AgentDefinition): Promise<string> {
  const recentRuns = await getRecentTaskRuns({ agent_name: definition.name, limit: 20 });

  const sections: string[] = [
    `# ${definition.name}`,
    `## Purpose\n${definition.description}`,
  ];

  if (recentRuns.length > 0) {
    const completed = recentRuns.filter((r) => r.status === "completed").length;
    const failed = recentRuns.filter((r) => r.status === "failed").length;
    sections.push(
      `## Recent Runs\n- ${completed} completed, ${failed} failed (last ${recentRuns.length} runs)`,
    );

    const lastOutputs = recentRuns
      .filter((r) => r.output_summary)
      .slice(0, 3)
      .map((r) => `- ${r.started_at?.split("T")[0]}: ${r.output_summary?.slice(0, 100)}`);
    if (lastOutputs.length) sections.push(`## Recent Output\n${lastOutputs.join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * Hash-check a channel agent's context and save a new version if changed.
 * Fast path — no LLM call. Called after every cron execution.
 */
export async function maybeRefreshAgentContext(definition: AgentDefinition): Promise<boolean> {
  const template = await buildAgentTemplate(definition);
  const hash = sha256(template);

  const existing = await getLatestAgentsMd(definition.name);
  if (existing?.input_hash === hash) return false;

  await saveAgentsMdVersion({
    content: template,
    template,
    inputHash: hash,
    agentName: definition.name,
  });
  return true;
}

// ── Subagent prompt ─────────────────────────────────────────────

function buildSubagentPrompt(
  currentContent: string,
  diff: string,
  template: string,
  tokenBudget: number,
): string {
  return `You are Edda's context editor. Your job is to maintain the AGENTS.md user profile document.

This document is embedded in the system prompt and shapes every decision the main agent makes.
Edit it carefully — every word matters.

## Current AGENTS.md (what's live now):
${currentContent || "(empty — this is the first version)"}

## What Changed Since Last Edit:
${diff}

## Raw Materials (full deterministic template):
${template}

## Instructions:
- Edit the current AGENTS.md to reflect the changes shown in the diff
- Preserve content that hasn't changed — don't rewrite for the sake of it
- Structure the document with these sections:
  1. **Identity** — who the user is (name, role, key facts)
  2. **Directives** — imperative rules from preferences + patterns ("Always...", "Never...", "Prefer...")
  3. **Key Entities** — top people, projects, companies with one-line descriptions
  4. **Item Types** — available types with icons, classification hints, and metadata schemas
  5. **Active Context** — what the user is currently working on
  6. **Boundaries** — privacy rules, confirmation settings
- Write directives as imperatives ("Always...", "Never...", "Prefer...")
- Keep total length under ${tokenBudget} tokens (~${tokenBudget * 4} characters)
- Drop low-value or redundant entries
- Merge related facts into single statements
- If this is the first version (empty current), build it from scratch using the raw materials

Save your edited version using the save_agents_md tool.`;
}
