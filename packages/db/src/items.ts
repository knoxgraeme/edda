/**
 * Item CRUD + semantic search
 */

import { getPool } from "./connection.js";
import type { Item, CreateItemInput, SearchResult, RetrievalContext } from "./types.js";

// ── Search re-ranking constants ──────────────────────────────────────────────

/** Temporal decay half-life in days. 30 days is aggressive for a memory system — tune up if
 *  older memories lose relevance too quickly. */
export const DECAY_HALF_LIFE_DAYS = 30;

/** ln(2) — used in exponential decay formula: exp(-LN2 * age / half_life) */
export const LN2 = 0.693;

/** Inner-to-outer limit multiplier — fetch N*RERANK_MULTIPLIER candidates for re-ranking */
export const RERANK_MULTIPLIER = 3;

/** All item columns except embedding — use for queries that don't need the vector */
export const ITEM_COLS = `id, type, content, summary, metadata, status, source, day, confirmed,
  parent_id, embedding_model, superseded_by, completed_at, pending_action,
  last_reinforced_at, created_at, updated_at`;

export async function createItem(input: CreateItemInput): Promise<Item> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO items (type, content, summary, metadata, status, source, day, confirmed, parent_id, embedding, embedding_model, pending_action)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${ITEM_COLS}`,
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
      input.embedding_model ?? null,
      input.pending_action ?? null,
    ],
  );
  return rows[0] as Item;
}

export async function getItemById(id: string): Promise<Item | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${ITEM_COLS} FROM items WHERE id = $1`, [id]);
  return (rows[0] as Item) ?? null;
}

const ITEM_UPDATE_COLUMNS = [
  'type', 'content', 'summary', 'metadata', 'status', 'source', 'day',
  'confirmed', 'parent_id', 'embedding', 'embedding_model', 'superseded_by',
  'completed_at', 'pending_action', 'last_reinforced_at',
] as const;

export async function updateItem(
  id: string,
  updates: Partial<Pick<Item, (typeof ITEM_UPDATE_COLUMNS)[number]>>,
): Promise<Item | null> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(
    ([k]) => ITEM_UPDATE_COLUMNS.includes(k as typeof ITEM_UPDATE_COLUMNS[number])
  );
  if (entries.length === 0) return getItemById(id);

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v));

  const { rows } = await pool.query(
    `UPDATE items SET ${sets}, updated_at = now() WHERE id = $1 RETURNING ${ITEM_COLS}`,
    [id, ...vals],
  );
  return (rows[0] as Item) ?? null;
}

export async function deleteItem(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    "DELETE FROM items WHERE id = $1",
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/** Safelist pattern for metadata keys — alphanumeric and underscore only */
const SAFE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Semantic search over items using pgvector cosine similarity.
 *
 * **Vector space note:** The quality of results depends on the query embedding
 * being generated with the same text format as the stored embeddings. Use
 * `buildEmbeddingText()` from the embed module for consistent formatting.
 * Mismatched text formats between query and stored embeddings will degrade
 * similarity scores.
 */
export async function searchItems(
  embedding: number[],
  options: {
    threshold?: number;
    limit?: number;
    type?: string;
    after?: string;
    agentKnowledgeOnly?: boolean;
    confirmedOnly?: boolean;
    excludeSuperseded?: boolean;
    metadata?: Record<string, string>;
    retrieval_context?: RetrievalContext;
  } = {},
): Promise<SearchResult[]> {
  const pool = getPool();
  const {
    threshold = 0.65,
    limit = 10,
    type,
    after,
    agentKnowledgeOnly,
    confirmedOnly,
    excludeSuperseded,
    metadata,
    retrieval_context: rc,
  } = options;

  // ── Build WHERE conditions for the inner CTE (ANN retrieval) ──
  const conditions = ["1 - (embedding <=> $1::vector) > $2"];
  if (excludeSuperseded !== false) {
    conditions.push("superseded_by IS NULL");
  }
  if (confirmedOnly !== false) {
    conditions.push("confirmed = true");
  }
  const params: unknown[] = [JSON.stringify(embedding), threshold];
  let paramIdx = 3;

  if (type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(type);
  }

  if (after) {
    conditions.push(`day >= $${paramIdx++}::date`);
    params.push(after);
  }

  if (agentKnowledgeOnly) {
    conditions.push(`type IN ('preference', 'learned_fact', 'pattern')`);
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      if (!SAFE_KEY_RE.test(key)) {
        throw new Error(`Invalid metadata key: ${key}`);
      }
      conditions.push(`metadata->>'${key}' = $${paramIdx++}`);
      params.push(value);
    }
  }

  // ── Retrieval context: filter-mode conditions (inner CTE) ──
  if (rc?.authorship_mode === "filter" && rc.authors?.length) {
    conditions.push(`metadata->>'created_by' = ANY($${paramIdx++})`);
    params.push(rc.authors);
  }
  if (rc?.type_mode === "filter" && rc.types?.length) {
    conditions.push(`type = ANY($${paramIdx++})`);
    params.push(rc.types);
  }

  // Inner limit: fetch extra candidates for re-ranking headroom
  const innerLimit = limit * RERANK_MULTIPLIER;
  const innerLimitIdx = paramIdx++;
  params.push(innerLimit);

  const outerLimitIdx = paramIdx++;
  params.push(limit);

  // ── Retrieval context: boost-mode multipliers (outer SELECT) ──
  const boostClauses: string[] = [];

  if (rc?.authorship_mode === "boost" && rc.authors?.length && rc.authorship_boost) {
    const authorsIdx = paramIdx++;
    const boostIdx = paramIdx++;
    params.push(rc.authors, rc.authorship_boost);
    boostClauses.push(
      `CASE WHEN c.metadata->>'created_by' = ANY($${authorsIdx}) THEN $${boostIdx}::float ELSE 1 END`,
    );
  }

  if (rc?.type_mode === "boost" && rc.types?.length && rc.type_boost) {
    const typesIdx = paramIdx++;
    const boostIdx = paramIdx++;
    params.push(rc.types, rc.type_boost);
    boostClauses.push(
      `CASE WHEN c.type = ANY($${typesIdx}) THEN $${boostIdx}::float ELSE 1 END`,
    );
  }

  const boostExpr = boostClauses.length > 0
    ? boostClauses.map((c) => `\n              * ${c}`).join("")
    : "";

  const { rows } = await pool.query(
    `WITH candidates AS (
       SELECT ${ITEM_COLS},
              1 - (embedding <=> $1::vector) AS raw_similarity
       FROM items
       WHERE ${conditions.join(" AND ")}
       ORDER BY embedding <=> $1::vector
       LIMIT $${innerLimitIdx}
     )
     SELECT ${ITEM_COLS.split(",").map((c) => `c.${c.trim()}`).join(", ")},
            c.raw_similarity,
            c.raw_similarity
              * EXP(-${LN2} * EXTRACT(EPOCH FROM (now() - COALESCE(c.last_reinforced_at, c.created_at))) / (${DECAY_HALF_LIFE_DAYS} * 86400))${boostExpr}
            AS similarity
     FROM candidates c
     ORDER BY similarity DESC
     LIMIT $${outerLimitIdx}`,
    params,
  );

  return rows as SearchResult[];
}

export async function getMetadataValues(type: string, key: string): Promise<string[]> {
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error(`Invalid metadata key: ${key}`);
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT metadata->>$2 AS val
     FROM items
     WHERE type = $1 AND metadata->>$2 IS NOT NULL AND confirmed = true
     ORDER BY val`,
    [type, key],
  );
  return rows.map((r: { val: string }) => r.val);
}

export async function batchCreateItems(inputs: CreateItemInput[]): Promise<Item[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const items: Item[] = [];
    for (const input of inputs) {
      const { rows } = await client.query(
        `INSERT INTO items (type, content, summary, metadata, status, source, day, confirmed, parent_id, embedding, embedding_model, pending_action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${ITEM_COLS}`,
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
          input.embedding_model ?? null,
          input.pending_action ?? null,
        ],
      );
      items.push(rows[0] as Item);
    }
    await client.query("COMMIT");
    return items;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getListItems(listName: string, limit: number = 200): Promise<Item[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS}
     FROM items
     WHERE confirmed = true AND status = 'active' AND type = 'list_item'
       AND metadata->>'list_name' = $1
     ORDER BY created_at
     LIMIT $2`,
    [listName, limit],
  );
  return rows as Item[];
}

export async function getTimeline(
  startDate: Date | string,
  endDate: Date | string,
  types?: string[],
  limit: number = 200,
): Promise<Item[]> {
  const pool = getPool();
  const conditions = ["confirmed = true", "day >= $1::date", "day <= $2::date"];
  const params: unknown[] = [startDate, endDate];
  let paramIdx = 3;

  if (types && types.length > 0) {
    conditions.push(`type = ANY($${paramIdx++})`);
    params.push(types);
  }

  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS}
     FROM items
     WHERE ${conditions.join(" AND ")}
     ORDER BY day, created_at
     LIMIT $${paramIdx}`,
    [...params, limit],
  );
  return rows as Item[];
}

const ORDER_BY_MAP: Record<string, string> = {
  recent: "created_at DESC",
  reinforced: "COALESCE(last_reinforced_at, updated_at) DESC",
  updated: "updated_at DESC",
} as const;

export async function getAgentKnowledge(
  options: { excludeSuperseded?: boolean; orderBy?: string; limit?: number } = {},
): Promise<Item[]> {
  const pool = getPool();
  const conditions = [
    "confirmed = true",
    "status = 'active'",
    "type IN ('preference', 'learned_fact', 'pattern')",
  ];

  if (options.excludeSuperseded !== false) {
    conditions.push("superseded_by IS NULL");
  }

  const orderBy = ORDER_BY_MAP[options.orderBy ?? "reinforced"] ?? ORDER_BY_MAP.reinforced;
  const limit = options.limit ?? 100;

  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS}
     FROM items WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy} LIMIT $1`,
    [limit],
  );
  return rows as Item[];
}

export async function getItemsByType(
  type: string,
  status?: string,
  limit: number = 100,
): Promise<Item[]> {
  const pool = getPool();
  const conditions = ["type = $1", "confirmed = true"];
  const params: unknown[] = [type];
  let paramIdx = 2;

  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  const { rows } = await pool.query(
    `SELECT ${ITEM_COLS}
     FROM items WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC
     LIMIT $${paramIdx}`,
    [...params, limit],
  );
  return rows as Item[];
}
