/**
 * Item types — dynamic type registry
 */

import { getPool } from "./connection.js";
import type { ItemType } from "./types.js";

/** System types that cannot be deleted. Keep in sync with migration-seeded types. */
const PROTECTED_TYPES = [
  "note",
  "task",
  "reminder",
  "event",
  "meeting",
  "decision",
  "journal",
  "preference",
  "learned_fact",
  "pattern",
  "notification",
  "session_summary",
  "daily_digest",
  "insight",
];

export async function getItemTypes(): Promise<ItemType[]> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM item_types ORDER BY name");
  return rows as ItemType[];
}

export async function getItemTypeByName(name: string): Promise<ItemType | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM item_types WHERE name = $1", [name]);
  return (rows[0] as ItemType) ?? null;
}

export async function createItemType(input: {
  name: string;
  icon: string;
  description: string;
  metadata_schema?: Record<string, unknown>;
  classification_hint: string;
}): Promise<ItemType> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.name,
      input.icon,
      input.description,
      JSON.stringify(input.metadata_schema ?? {}),
      input.classification_hint,
    ],
  );
  return rows[0] as ItemType;
}

export async function deleteItemType(name: string): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM item_types WHERE name = $1 AND name != ALL($2)", [
    name,
    PROTECTED_TYPES,
  ]);
}
