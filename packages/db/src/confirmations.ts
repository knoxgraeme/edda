/**
 * Unified confirm/reject helpers for pending items, entities, and item types.
 */

import { getPool } from "./index.js";

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
