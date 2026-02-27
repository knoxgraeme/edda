/**
 * Unified confirm/reject helpers for pending items, entities, and item types.
 */

import { getPool } from "./connection.js";
import type { PendingItem } from "./types.js";

const ALLOWED_TABLES = new Set(["items", "entities", "item_types", "telegram_paired_users"]);

type ConfirmableTable = "items" | "entities" | "item_types" | "telegram_paired_users";

function assertValidTable(table: string): asserts table is ConfirmableTable {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid table for confirmation: ${table}`);
  }
}

export async function confirmPending(
  table: ConfirmableTable,
  id: string,
): Promise<void> {
  assertValidTable(table);
  const pool = getPool();
  if (table === "telegram_paired_users") {
    await pool.query(
      "UPDATE telegram_paired_users SET status = 'approved' WHERE id = $1",
      [id],
    );
  } else if (table === "item_types") {
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
  table: ConfirmableTable,
  id: string,
): Promise<void> {
  assertValidTable(table);
  const pool = getPool();
  if (table === "telegram_paired_users") {
    await pool.query(
      "UPDATE telegram_paired_users SET status = 'rejected' WHERE id = $1",
      [id],
    );
  } else if (table === "item_types") {
    await pool.query("DELETE FROM item_types WHERE name = $1 AND confirmed = false", [id]);
  } else {
    await pool.query(`DELETE FROM ${table} WHERE id = $1 AND confirmed = false`, [id]);
  }
}

export async function getPendingItems(): Promise<PendingItem[]> {
  const pool = getPool();

  const [items, entities, itemTypes, pairings] = await Promise.all([
    pool.query(
      "SELECT id, type, content, summary, pending_action, created_at FROM items WHERE confirmed = false ORDER BY created_at DESC",
    ),
    pool.query(
      "SELECT id, name, type, description, pending_action, created_at FROM entities WHERE confirmed = false ORDER BY created_at DESC",
    ),
    pool.query(
      "SELECT name, icon, description, pending_action, created_at FROM item_types WHERE confirmed = false ORDER BY created_at DESC",
    ),
    pool.query(
      "SELECT id, telegram_id, display_name, status, created_at FROM telegram_paired_users WHERE status = 'pending' ORDER BY created_at DESC",
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

  for (const row of pairings.rows) {
    pending.push({
      id: row.id,
      table: "telegram_paired_users",
      type: "telegram_pairing",
      label: row.display_name || `Telegram user ${row.telegram_id}`,
      description: null,
      pendingAction: "Telegram user requesting access",
      createdAt: row.created_at,
    });
  }

  pending.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return pending;
}
