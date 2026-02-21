/**
 * Item CRUD + semantic search
 */

import { getPool } from "./index.js";
import type { Item, CreateItemInput, SearchResult } from "./types.js";

export async function createItem(input: CreateItemInput): Promise<Item> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO items (type, content, summary, metadata, status, source, day, confirmed, parent_id, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.type,
      input.content,
      input.summary ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.status ?? "active",
      input.source ?? "chat",
      input.day ?? new Date().toISOString().split("T")[0],
      input.confirmed ?? true,
      input.parent_id ?? null,
      input.embedding ? JSON.stringify(input.embedding) : null,
    ],
  );
  return rows[0] as Item;
}

export async function getItemById(id: string): Promise<Item | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM items WHERE id = $1", [id]);
  return (rows[0] as Item) ?? null;
}

export async function updateItem(
  id: string,
  updates: Partial<Item>,
): Promise<Item | null> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(([k]) => k !== "id");
  if (entries.length === 0) return getItemById(id);

  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) => (typeof v === "object" ? JSON.stringify(v) : v));

  const { rows } = await pool.query(
    `UPDATE items SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...vals],
  );
  return (rows[0] as Item) ?? null;
}

export async function searchItems(
  embedding: number[],
  options: {
    threshold?: number;
    limit?: number;
    type?: string;
    agentKnowledgeOnly?: boolean;
  } = {},
): Promise<SearchResult[]> {
  const pool = getPool();
  const { threshold = 0.85, limit = 10, type, agentKnowledgeOnly } = options;

  const conditions = ["1 - (embedding <=> $1::vector) > $2"];
  const params: unknown[] = [JSON.stringify(embedding), threshold];
  let paramIdx = 3;

  if (type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(type);
  }

  if (agentKnowledgeOnly) {
    conditions.push(`type IN ('preference', 'learned_fact', 'pattern')`);
  }

  const { rows } = await pool.query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
     FROM items
     WHERE ${conditions.join(" AND ")}
     ORDER BY similarity DESC
     LIMIT $${paramIdx}`,
    [...params, limit],
  );

  return rows as SearchResult[];
}

export async function getItemsByType(type: string, status?: string): Promise<Item[]> {
  const pool = getPool();
  const conditions = ["type = $1", "confirmed = true"];
  const params: unknown[] = [type];

  if (status) {
    conditions.push("status = $2");
    params.push(status);
  }

  const { rows } = await pool.query(
    `SELECT * FROM items WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    params,
  );
  return rows as Item[];
}
