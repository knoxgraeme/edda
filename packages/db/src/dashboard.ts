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
      `SELECT ${ITEM_COLS} FROM items
       WHERE confirmed = true AND status = 'active' AND type = 'list_item'
       ORDER BY metadata->>'list_name', created_at
       LIMIT 100`,
    ),
    pool.query(
      `SELECT ${ITEM_COLS} FROM items WHERE confirmed = false ORDER BY created_at DESC
       LIMIT 100`,
    ),
  ]);

  // Group list items by list_name
  const listMap: Record<string, Item[]> = {};
  for (const item of lists.rows as Item[]) {
    const listName = (item.metadata as Record<string, string>).list_name ?? "other";
    if (!listMap[listName]) listMap[listName] = [];
    listMap[listName].push(item);
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
