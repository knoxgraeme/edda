/**
 * Item types — dynamic type registry
 */

import { getPool } from "./connection.js";
import type { ItemType } from "./types.js";

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
  dashboard_section?: string;
  completable?: boolean;
  has_due_date?: boolean;
  is_list?: boolean;
}): Promise<ItemType> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, is_user_created, dashboard_section, completable, has_due_date, is_list)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.name,
      input.icon,
      input.description,
      JSON.stringify(input.metadata_schema ?? {}),
      input.classification_hint,
      input.dashboard_section ?? "captured",
      input.completable ?? false,
      input.has_due_date ?? false,
      input.is_list ?? false,
    ],
  );
  return rows[0] as ItemType;
}

export async function confirmItemType(name: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "UPDATE item_types SET confirmed = true, pending_action = NULL WHERE name = $1",
    [name],
  );
}

export async function deleteItemType(name: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "DELETE FROM item_types WHERE name = $1 AND built_in = false",
    [name],
  );
}
