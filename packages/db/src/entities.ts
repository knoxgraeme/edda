/**
 * Entity CRUD + semantic search
 */

import { getPool } from "./index.js";
import type { Entity, EntitySearchResult, EntityType } from "./types.js";

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
     RETURNING *`,
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

export async function updateEntity(
  id: string,
  updates: Partial<Entity>,
): Promise<Entity | null> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(([k]) => k !== "id");
  if (entries.length === 0) return getEntityById(id);

  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) =>
    Array.isArray(v) ? v : typeof v === "object" ? JSON.stringify(v) : v,
  );

  const { rows } = await pool.query(
    `UPDATE entities SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...vals],
  );
  return (rows[0] as Entity) ?? null;
}

export async function getEntityById(id: string): Promise<Entity | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM entities WHERE id = $1", [id]);
  return (rows[0] as Entity) ?? null;
}

export async function getEntitiesByName(name: string): Promise<Entity[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM entities WHERE name ILIKE $1 OR $1 = ANY(aliases)",
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
    `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
     FROM entities
     WHERE ${conditions.join(" AND ")}
     ORDER BY similarity DESC
     LIMIT $${paramIdx}`,
    [...params, limit],
  );

  return rows as EntitySearchResult[];
}

export async function getTopEntities(limit: number = 15): Promise<Entity[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM entities ORDER BY mention_count DESC LIMIT $1",
    [limit],
  );
  return rows as Entity[];
}
