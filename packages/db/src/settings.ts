/**
 * Settings CRUD — single-row settings table.
 * Cached in memory, refreshed on startup and after each conversation.
 */

import { getPool } from "./index.js";
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

export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(([k]) => k !== "id");
  if (entries.length === 0) return getSettings();

  const sets = entries.map(([k], i) => `${k} = $${i + 1}`).join(", ");
  const vals = entries.map(([, v]) => v);

  await pool.query(
    `UPDATE settings SET ${sets}, updated_at = now() WHERE id = true`,
    vals,
  );

  return refreshSettings();
}
