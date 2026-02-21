/**
 * AGENTS.md generator — writes user context snapshot
 *
 * Queries preferences, facts, patterns, and top entities from Postgres,
 * formats into markdown within the token budget, writes to ./AGENTS.md.
 * Called after every afterAgent hook and on startup.
 */

import { mkdir, readdir, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSettingsSync,
  getItemsByType,
  getTopEntities,
  getPendingConfirmationsCount,
} from "@edda/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, "../..");
const AGENTS_MD_PATH = join(SERVER_ROOT, "AGENTS.md");
const AGENTS_MD_TMP = join(SERVER_ROOT, "AGENTS.md.tmp");
const HISTORY_DIR = join(SERVER_ROOT, ".agents-history");

/** Rough token estimate: 1 token ≈ 4 characters */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate sections proportionally to fit within the token budget.
 * Preserves section headers, removes lines from the bottom of each section.
 */
function enforceTokenBudget(sections: string[], budget: number): string[] {
  const joined = sections.join("\n\n");
  const currentTokens = estimateTokens(joined);

  if (currentTokens <= budget) return sections;

  const ratio = budget / currentTokens;
  return sections.map((section) => {
    const lines = section.split("\n");
    const header = lines[0];
    const body = lines.slice(1);
    const keepCount = Math.max(1, Math.floor(body.length * ratio));
    return [header, ...body.slice(0, keepCount)].join("\n");
  });
}

/**
 * Archive current AGENTS.md to .agents-history/ and prune old versions.
 */
async function archiveCurrentVersion(maxVersions: number): Promise<void> {
  try {
    await stat(AGENTS_MD_PATH);
  } catch {
    return; // No existing file to archive
  }

  await mkdir(HISTORY_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = join(HISTORY_DIR, `AGENTS-${timestamp}.md`);
  await copyFile(AGENTS_MD_PATH, archivePath);

  // Prune oldest versions beyond maxVersions
  const files = (await readdir(HISTORY_DIR))
    .filter((f) => f.startsWith("AGENTS-") && f.endsWith(".md"))
    .sort();

  if (files.length > maxVersions) {
    const toDelete = files.slice(0, files.length - maxVersions);
    await Promise.all(toDelete.map((f) => rm(join(HISTORY_DIR, f))));
  }
}

export async function generateAgentsMd(): Promise<void> {
  const settings = getSettingsSync();

  const [preferences, facts, patterns, entities, pendingCount] = await Promise.all([
    getItemsByType("preference", "active"),
    getItemsByType("learned_fact", "active"),
    getItemsByType("pattern", "active"),
    getTopEntities(settings.agents_md_max_entities),
    getPendingConfirmationsCount(),
  ]);

  const maxPerCategory = settings.agents_md_max_per_category;

  const sections: string[] = [];

  // Header with pending confirmations
  const headerParts = ["# AGENTS.md — User Context"];
  if (pendingCount > 0) {
    headerParts.push(`\n**Pending confirmations:** ${pendingCount}`);
  }
  sections.push(headerParts.join(""));

  if (preferences.length > 0) {
    const items = preferences.slice(0, maxPerCategory);
    sections.push(`## Preferences\n${items.map((p) => `- ${p.content}`).join("\n")}`);
  }

  if (facts.length > 0) {
    const items = facts.slice(0, maxPerCategory);
    sections.push(`## Known Facts\n${items.map((f) => `- ${f.content}`).join("\n")}`);
  }

  if (patterns.length > 0) {
    const items = patterns.slice(0, maxPerCategory);
    sections.push(`## Patterns\n${items.map((p) => `- ${p.content}`).join("\n")}`);
  }

  if (entities.length > 0) {
    sections.push(
      `## Key People & Projects\n${entities.map((e) => `- **${e.name}** (${e.type}) — mentioned ${e.mention_count}x`).join("\n")}`,
    );
  }

  const budgeted = enforceTokenBudget(sections, settings.agents_md_token_budget);
  const content = budgeted.join("\n\n") + "\n";

  // Archive current version before overwriting
  await archiveCurrentVersion(settings.agents_md_max_versions);

  // Atomic write: temp file → rename
  await writeFile(AGENTS_MD_TMP, content, "utf-8");
  await rename(AGENTS_MD_TMP, AGENTS_MD_PATH);
}
