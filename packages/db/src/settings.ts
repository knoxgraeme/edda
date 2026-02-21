/**
 * Settings CRUD — single-row settings table.
 * Cached in memory, refreshed on startup and after each conversation.
 */

import { getPool } from "./connection.js";
import type { Settings } from "./types.js";

let cachedSettings: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings;
  return refreshSettings();
}

export function getSettingsSync(): Settings {
  if (!cachedSettings) {
    throw new Error("Settings not loaded — call refreshSettings() on startup");
  }
  return cachedSettings;
}

export async function refreshSettings(): Promise<Settings> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM settings WHERE id = true");
  if (rows.length === 0) {
    throw new Error("Settings row missing — run migrations first");
  }
  cachedSettings = rows[0] as Settings;
  return cachedSettings;
}

const SETTINGS_UPDATE_COLUMNS = [
  "llm_provider",
  "default_model",
  "embedding_provider",
  "embedding_model",
  "embedding_dimensions",
  "search_provider",
  "web_search_enabled",
  "web_search_max_results",
  "checkpointer_backend",
  "memory_extraction_enabled",
  "memory_extraction_cron",
  "memory_extraction_model",
  "memory_reinforce_threshold",
  "memory_update_threshold",
  "entity_exact_threshold",
  "entity_fuzzy_threshold",
  "agents_md_token_budget",
  "agents_md_max_per_category",
  "agents_md_max_versions",
  "agents_md_max_entities",
  "tool_call_limit_global",
  "tool_call_limit_delete",
  "tool_call_limit_archive",
  "daily_digest_cron",
  "daily_digest_model",
  "weekly_review_cron",
  "weekly_review_model",
  "type_evolution_cron",
  "type_evolution_model",
  "user_crons_enabled",
  "user_cron_check_interval",
  "user_cron_model",
  "cron_runner",
  "langgraph_platform_url",
  "approval_new_type",
  "approval_archive_stale",
  "approval_merge_entity",
  "system_prompt_override",
  "setup_completed",
  "user_display_name",
  "user_timezone",
] as const;

export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(([k]) =>
    SETTINGS_UPDATE_COLUMNS.includes(k as (typeof SETTINGS_UPDATE_COLUMNS)[number]),
  );
  if (entries.length === 0) return getSettings();

  const sets = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(", ");
  const vals = entries.map(([, v]) => v);

  await pool.query(
    `UPDATE settings SET ${sets}, updated_at = now() WHERE id = true`,
    vals,
  );

  return refreshSettings();
}
