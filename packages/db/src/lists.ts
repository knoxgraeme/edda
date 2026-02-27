/**
 * List CRUD + semantic search
 */

import { getPool } from "./connection.js";
import { ITEM_COLS } from "./items.js";
import type { List, CreateListInput, ListWithCount, ListSearchResult, Item } from "./types.js";

export const LIST_COLS = `id, name, normalized_name, summary, icon, list_type,
  status, embedding_model, metadata, created_at, updated_at`;

export async function createList(input: CreateListInput): Promise<List> {
  const pool = getPool();
  const normalizedName = input.normalized_name ?? input.name.trim().toLowerCase();
  const { rows } = await pool.query(
    `INSERT INTO lists (name, normalized_name, summary, icon, list_type, embedding, embedding_model, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${LIST_COLS}`,
    [
      input.name,
      normalizedName,
      input.summary ?? null,
      input.icon ?? '📋',
      input.list_type ?? 'rolling',
      input.embedding ? JSON.stringify(input.embedding) : null,
      input.embedding_model ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return rows[0] as List;
}

export async function getListById(id: string): Promise<List | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${LIST_COLS} FROM lists WHERE id = $1`, [id]);
  return (rows[0] as List) ?? null;
}

export async function getListByName(name: string): Promise<List | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${LIST_COLS} FROM lists
     WHERE normalized_name = lower(trim($1)) AND status = 'active'
     LIMIT 1`,
    [name],
  );
  return (rows[0] as List) ?? null;
}

/**
 * Resolve a list by name with fuzzy fallback.
 * Step 1: exact normalized_name match. Step 2: ILIKE substring match.
 */
export async function resolveList(name: string): Promise<List | null> {
  const exact = await getListByName(name);
  if (exact) return exact;

  const escaped = name.replace(/[%_]/g, "\\$&");
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${LIST_COLS} FROM lists
     WHERE (name ILIKE $1 OR normalized_name ILIKE $1) AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`,
    [`%${escaped}%`],
  );
  return (rows[0] as List) ?? null;
}

export async function getAllLists(
  options: { status?: string } = {},
): Promise<ListWithCount[]> {
  const pool = getPool();
  const status = options.status ?? 'active';
  const { rows } = await pool.query(
    `SELECT l.id, l.name, l.normalized_name, l.summary, l.icon, l.list_type,
       l.status, l.embedding_model, l.metadata, l.created_at, l.updated_at,
       COALESCE(ic.cnt, 0) AS item_count
     FROM lists l
     LEFT JOIN (
       SELECT list_id, count(*) AS cnt
       FROM items
       WHERE confirmed = true AND status = 'active' AND list_id IS NOT NULL
       GROUP BY list_id
     ) ic ON ic.list_id = l.id
     WHERE l.status = $1
     ORDER BY l.updated_at DESC`,
    [status],
  );
  return rows as ListWithCount[];
}

export async function getListItems(listId: string, limit: number = 200): Promise<Item[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS} FROM items
     WHERE list_id = $1 AND confirmed = true AND status = 'active'
     ORDER BY created_at
     LIMIT $2`,
    [listId, limit],
  );
  return rows as Item[];
}

const LIST_UPDATE_COLUMNS = [
  'name', 'normalized_name', 'summary', 'icon', 'list_type',
  'status', 'embedding', 'embedding_model', 'metadata',
] as const;

export async function updateList(
  id: string,
  updates: Partial<Pick<List, (typeof LIST_UPDATE_COLUMNS)[number]>>,
): Promise<List | null> {
  const pool = getPool();

  // Auto-regenerate normalized_name when name changes
  if (updates.name && !updates.normalized_name) {
    updates.normalized_name = updates.name.trim().toLowerCase();
  }

  const entries = Object.entries(updates).filter(
    ([k]) => LIST_UPDATE_COLUMNS.includes(k as (typeof LIST_UPDATE_COLUMNS)[number]),
  );
  if (entries.length === 0) return getListById(id);

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) =>
    typeof v === "object" && v !== null ? JSON.stringify(v) : v,
  );

  const { rows } = await pool.query(
    `UPDATE lists SET ${sets} WHERE id = $1 RETURNING ${LIST_COLS}`,
    [id, ...vals],
  );
  return (rows[0] as List) ?? null;
}

export async function searchLists(
  embedding: number[],
  options: { threshold?: number; limit?: number; status?: string } = {},
): Promise<ListSearchResult[]> {
  const pool = getPool();
  const { threshold = 0.5, limit = 10, status = 'active' } = options;
  const { rows } = await pool.query(
    `SELECT ${LIST_COLS},
       1 - (embedding <=> $1::vector) AS similarity
     FROM lists
     WHERE status = $2
       AND 1 - (embedding <=> $1::vector) > $3
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [JSON.stringify(embedding), status, threshold, limit],
  );
  return rows as ListSearchResult[];
}
