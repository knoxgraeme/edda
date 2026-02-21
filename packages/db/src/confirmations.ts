/**
 * Unified confirm/reject helpers for pending items, entities, and item types.
 */

import { getPool } from "./index.js";
import type { PendingItem } from "./types.js";

const ALLOWED_TABLES = new Set(["items", "entities", "item_types"]);

function assertValidTable(table: string): asserts table is "items" | "entities" | "item_types" {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid table for confirmation: ${table}`);
  }
}

export async function confirmPending(
  table: "items" | "entities" | "item_types",
  id: string,
): Promise<void> {
  assertValidTable(table);
  const pool = getPool();
  if (table === "item_types") {
    await pool.query(
      "UPDATE item_types SET confirmed = true, pending_action = NULL WHERE name = $1",
      [id],
    );
  } else {
    await pool.query(
      `UPDATE ${table} SET confirmed = true, pending_action = NULL WHERE id = $1`,
      [id],
    );
  }
}

export async function rejectPending(
  table: "items" | "entities" | "item_types",
  id: string,
): Promise<void> {
  assertValidTable(table);
  const pool = getPool();
  if (table === "item_types") {
    await pool.query("DELETE FROM item_types WHERE name = $1 AND confirmed = false", [id]);
  } else {
    await pool.query(`DELETE FROM ${table} WHERE id = $1 AND confirmed = false`, [id]);
  }
}

export async function getPendingItems(): Promise<PendingItem[]> {
  const pool = getPool();

  const [items, entities, itemTypes] = await Promise.all([
    pool.query(
      "SELECT id, type, content, summary, pending_action, created_at FROM items WHERE confirmed = false ORDER BY created_at DESC",
    ),
    pool.query(
      "SELECT id, name, type, description, pending_action, created_at FROM entities WHERE confirmed = false ORDER BY created_at DESC",
    ),
    pool.query(
      "SELECT name, icon, description, pending_action, created_at FROM item_types WHERE confirmed = false ORDER BY created_at DESC",
    ),
  ]);

  const pending: PendingItem[] = [];

  for (const row of items.rows) {
    pending.push({
      id: row.id,
      table: "items",
      type: row.type,
      label: row.content,
      description: row.summary,
      pendingAction: row.pending_action,
      createdAt: row.created_at,
    });
  }

  for (const row of entities.rows) {
    pending.push({
      id: row.id,
      table: "entities",
      type: `entity:${row.type}`,
      label: row.name,
      description: row.description,
      pendingAction: row.pending_action,
      createdAt: row.created_at,
    });
  }

  for (const row of itemTypes.rows) {
    pending.push({
      id: row.name,
      table: "item_types",
      type: "item_type",
      label: `${row.icon} ${row.name}`,
      description: row.description,
      pendingAction: row.pending_action,
      createdAt: row.created_at,
    });
  }

  pending.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return pending;
}
