/**
 * Dashboard query — assembles the daily overview
 */

import { getPool } from "./connection.js";
import { ITEM_COLS, QUALIFIED_ITEM_COLS } from "./items.js";
import type { DashboardData, Item, List } from "./types.js";

/** List columns aliased with _l_ prefix to avoid collisions in JOINs with items */
const ALIASED_LIST_COLS = `l.id AS _l_id, l.name AS _l_name, l.normalized_name AS _l_normalized_name,
  l.summary AS _l_summary, l.icon AS _l_icon, l.list_type AS _l_list_type,
  l.status AS _l_status, l.embedding_model AS _l_embedding_model,
  l.metadata AS _l_metadata, l.created_at AS _l_created_at, l.updated_at AS _l_updated_at`;

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
       LEFT JOIN items i ON i.list_id = l.id
         AND i.confirmed = true AND i.status = 'active'
       WHERE l.status = 'active'
       ORDER BY l.name, i.created_at
       LIMIT 200`,
    ),
    pool.query(
      `SELECT ${ITEM_COLS} FROM items WHERE confirmed = false ORDER BY created_at DESC
       LIMIT 100`,
    ),
  ]);

  // Group list items by list id, extracting aliased _l_ columns
  const listMap: Record<string, { list: List; items: Item[] }> = {};
  for (const row of lists.rows as Record<string, unknown>[]) {
    const lid = row._l_id as string;
    if (!listMap[lid]) {
      listMap[lid] = {
        list: {
          id: lid,
          name: row._l_name as string,
          normalized_name: row._l_normalized_name as string,
          summary: (row._l_summary as string) ?? null,
          icon: row._l_icon as string,
          list_type: row._l_list_type as List["list_type"],
          status: row._l_status as List["status"],
          embedding: null,
          embedding_model: (row._l_embedding_model as string) ?? null,
          metadata: (row._l_metadata as Record<string, unknown>) ?? {},
          created_at: row._l_created_at as string,
          updated_at: row._l_updated_at as string,
        },
        items: [],
      };
    }
    // LEFT JOIN produces NULL item columns for empty lists — skip those rows
    if (row.id != null) {
      const item: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        if (!key.startsWith("_l_")) {
          item[key] = row[key];
        }
      }
      listMap[lid].items.push(item as unknown as Item);
    }
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
