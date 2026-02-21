/**
 * Entity CRUD + semantic search
 */

import { getPool } from "./connection.js";

import type { Entity, EntitySearchResult, EntityType, Item } from "./types.js";

/** All entity columns except embedding */
export const ENTITY_COLS = `id, name, type, aliases, description, mention_count,
  last_seen_at, confirmed, pending_action, metadata, created_at, updated_at`;

export async function upsertEntity(input: {
  name: string;
  type: EntityType;
  aliases?: string[];
  description?: string;
  embedding?: number[];
}): Promise<Entity> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO entities (name, type, aliases, description, embedding)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name) DO UPDATE SET
       type = EXCLUDED.type,
       aliases = EXCLUDED.aliases,
       description = COALESCE(EXCLUDED.description, entities.description),
       embedding = COALESCE(EXCLUDED.embedding, entities.embedding),
       mention_count = entities.mention_count + 1,
       last_seen_at = now(),
       updated_at = now()
     RETURNING ${ENTITY_COLS}`,
    [
      input.name,
      input.type,
      input.aliases ?? [],
      input.description ?? null,
      input.embedding ? JSON.stringify(input.embedding) : null,
    ],
  );
  return rows[0] as Entity;
}

const ENTITY_UPDATE_COLUMNS = [
  'name', 'type', 'aliases', 'description', 'mention_count',
  'last_seen_at', 'embedding', 'confirmed', 'pending_action', 'metadata',
] as const;

export async function updateEntity(
  id: string,
  updates: Partial<Entity>,
): Promise<Entity | null> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(
    ([k]) => ENTITY_UPDATE_COLUMNS.includes(k as typeof ENTITY_UPDATE_COLUMNS[number])
  );
  if (entries.length === 0) return getEntityById(id);

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) =>
    Array.isArray(v) ? v : typeof v === "object" && v !== null ? JSON.stringify(v) : v,
  );

  const { rows } = await pool.query(
    `UPDATE entities SET ${sets}, updated_at = now() WHERE id = $1 RETURNING ${ENTITY_COLS}`,
    [id, ...vals],
  );
  return (rows[0] as Entity) ?? null;
}

export async function getEntityById(id: string): Promise<Entity | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${ENTITY_COLS} FROM entities WHERE id = $1`, [id]);
  return (rows[0] as Entity) ?? null;
}

export async function getEntitiesByName(name: string): Promise<Entity[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${ENTITY_COLS} FROM entities WHERE name ILIKE $1 OR $1 = ANY(aliases)`,
    [`%${name}%`],
  );
  return rows as Entity[];
}

export async function searchEntities(
  embedding: number[],
  options: { threshold?: number; limit?: number; type?: EntityType } = {},
): Promise<EntitySearchResult[]> {
  const pool = getPool();
  const { threshold = 0.8, limit = 5, type } = options;

  const conditions = ["1 - (embedding <=> $1::vector) > $2"];
  const params: unknown[] = [JSON.stringify(embedding), threshold];
  let paramIdx = 3;

  if (type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(type);
  }

  const { rows } = await pool.query(
    `SELECT ${ENTITY_COLS}, 1 - (embedding <=> $1::vector) AS similarity
     FROM entities
     WHERE ${conditions.join(" AND ")}
     ORDER BY similarity DESC
     LIMIT $${paramIdx}`,
    [...params, limit],
  );

  return rows as EntitySearchResult[];
}

export async function resolveEntity(name: string): Promise<Entity | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${ENTITY_COLS} FROM entities
     WHERE name ILIKE $1 OR $1 ILIKE ANY(aliases)
     ORDER BY mention_count DESC
     LIMIT 1`,
    [name],
  );
  return (rows[0] as Entity) ?? null;
}

export async function getEntityItems(
  entityId: string,
  options: { limit?: number } = {},
): Promise<Item[]> {
  const pool = getPool();
  const limit = options.limit ?? 20;
  const { rows } = await pool.query(
    `SELECT i.id, i.type, i.content, i.summary, i.metadata, i.status, i.source, i.day,
            i.confirmed, i.parent_id, i.embedding_model, i.superseded_by, i.completed_at,
            i.pending_action, i.last_reinforced_at, i.created_at, i.updated_at
     FROM items i
     JOIN item_entities ie ON i.id = ie.item_id
     WHERE ie.entity_id = $1 AND i.confirmed = true
     ORDER BY i.created_at DESC
     LIMIT $2`,
    [entityId, limit],
  );
  return rows as Item[];
}

export async function linkItemEntity(
  itemId: string,
  entityId: string,
  relationship: string = "mentioned",
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO item_entities (item_id, entity_id, relationship)
     VALUES ($1, $2, $3)
     ON CONFLICT (item_id, entity_id) DO UPDATE SET relationship = $3`,
    [itemId, entityId, relationship],
  );
}

export async function listEntities(
  options: { type?: EntityType; search?: string; limit?: number } = {},
): Promise<Entity[]> {
  const pool = getPool();
  const conditions: string[] = ["confirmed = true"];
  const params: unknown[] = [];
  let idx = 1;

  if (options.type) {
    conditions.push(`type = $${idx++}`);
    params.push(options.type);
  }
  if (options.search) {
    conditions.push(`(name ILIKE $${idx} OR $${idx} ILIKE ANY(aliases))`);
    params.push(`%${options.search}%`);
    idx++;
  }

  const limit = options.limit ?? 100;
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT ${ENTITY_COLS} FROM entities
     WHERE ${conditions.join(" AND ")}
     ORDER BY mention_count DESC, updated_at DESC
     LIMIT $${idx}`,
    params,
  );
  return rows as Entity[];
}

export async function getTopEntities(limit: number = 15): Promise<Entity[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${ENTITY_COLS} FROM entities ORDER BY mention_count DESC LIMIT $1`,
    [limit],
  );
  return rows as Entity[];
}
