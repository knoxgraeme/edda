/**
 * Dashboard query — assembles the daily overview
 */

import { getPool } from "./connection.js";
import { ITEM_COLS, QUALIFIED_ITEM_COLS } from "./items.js";
import type { DashboardData, Item, List } from "./types.js";

/** List columns aliased with list_ prefix to avoid collisions in JOINs with items */
const ALIASED_LIST_COLS = `l.id AS list_id, l.name AS list_name, l.normalized_name AS list_normalized_name,
  l.summary AS list_summary, l.icon AS list_icon, l.list_type AS list_list_type,
  l.status AS list_status, l.embedding_model AS list_embedding_model,
  l.metadata AS list_metadata, l.created_at AS list_created_at, l.updated_at AS list_updated_at`;

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
      `SELECT ${ALIASED_LIST_COLS}, ${QUALIFIED_ITEM_COLS}
       FROM lists l
       JOIN items i ON i.list_id = l.id
       WHERE l.status = 'active'
         AND i.confirmed = true AND i.status = 'active'
       ORDER BY l.name, i.created_at
       LIMIT 200`,
    ),
    pool.query(
      `SELECT ${ITEM_COLS} FROM items WHERE confirmed = false ORDER BY created_at DESC
       LIMIT 100`,
    ),
  ]);

  // Group list items by list id, extracting aliased list_ columns
  const listMap: Record<string, { list: List; items: Item[] }> = {};
  for (const row of lists.rows as Record<string, unknown>[]) {
    const lid = row.list_id as string;
    if (!listMap[lid]) {
      listMap[lid] = {
        list: {
          id: lid,
          name: row.list_name as string,
          normalized_name: row.list_normalized_name as string,
          summary: (row.list_summary as string) ?? null,
          icon: row.list_icon as string,
          list_type: row.list_list_type as List["list_type"],
          status: row.list_status as List["status"],
          embedding: null,
          embedding_model: (row.list_embedding_model as string) ?? null,
          metadata: (row.list_metadata as Record<string, unknown>) ?? {},
          created_at: row.list_created_at as string,
          updated_at: row.list_updated_at as string,
        },
        items: [],
      };
    }
    listMap[lid].items.push(row as unknown as Item);
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
