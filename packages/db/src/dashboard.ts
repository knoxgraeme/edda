/**
 * Dashboard query — assembles the daily overview
 */

import { getPool } from "./connection.js";
import { ITEM_COLS } from "./items.js";
import type { DashboardData, Item } from "./types.js";

export async function getDashboard(day?: string): Promise<DashboardData> {
  const pool = getPool();
  const today = day ?? new Date().toISOString().split("T")[0];

  const [dueToday, capturedToday, openItems, lists, pending] = await Promise.all([
    pool.query(
      `SELECT ${ITEM_COLS} FROM items
       WHERE confirmed = true AND status = 'active'
         AND safe_date(metadata->>'due_date') = $1::date
       ORDER BY created_at
       LIMIT 100`,
      [today],
    ),
    pool.query(
      `SELECT ${ITEM_COLS} FROM items
       WHERE confirmed = true AND day = $1
         AND type NOT IN ('preference', 'learned_fact', 'pattern')
       ORDER BY created_at DESC
       LIMIT 100`,
      [today],
    ),
    pool.query(
      `SELECT ${ITEM_COLS} FROM items
       WHERE confirmed = true AND status = 'active'
         AND type IN ('task', 'reminder')
         AND (metadata->>'due_date' IS NULL
              OR safe_date(metadata->>'due_date') < $1::date)
       ORDER BY created_at
       LIMIT 100`,
      [today],
    ),
    pool.query(
      `SELECT p.content AS list_name, ${ITEM_COLS.split(",").map((c) => `li.${c.trim()}`).join(", ")}
       FROM items p
       JOIN items li ON li.parent_id = p.id
       WHERE p.type = 'list' AND p.confirmed = true AND p.status = 'active'
         AND li.type = 'list_item' AND li.confirmed = true AND li.status = 'active'
       ORDER BY p.content, li.created_at
       LIMIT 100`,
    ),
    pool.query(
      `SELECT ${ITEM_COLS} FROM items WHERE confirmed = false ORDER BY created_at DESC
       LIMIT 100`,
    ),
  ]);

  // Group list items by parent list name
  const listMap: Record<string, Item[]> = {};
  for (const row of lists.rows as (Item & { list_name: string })[]) {
    const listName = row.list_name ?? "other";
    if (!listMap[listName]) listMap[listName] = [];
    listMap[listName].push(row);
  }

  return {
    due_today: dueToday.rows as Item[],
    captured_today: capturedToday.rows as Item[],
    open_items: openItems.rows as Item[],
    lists: listMap,
    pending_confirmations: pending.rows as Item[],
  };
}

export async function getPendingConfirmationsCount(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM items WHERE confirmed = false) +
       (SELECT count(*) FROM item_types WHERE confirmed = false) +
       (SELECT count(*) FROM entities WHERE confirmed = false)
     AS total`,
  );
  return Number(rows[0]?.total) || 0;
}
