/**
 * Memory Queries — threshold queries for memory sync cron.
 */

import { getPool } from "./connection.js";
import type { EntityType } from "./types.js";

export interface EntityAboveThreshold {
  id: string;
  name: string;
  type: EntityType;
  mention_count: number;
  item_count: number;
}

export async function getEntitiesAboveThreshold(
  entityTypes: EntityType[],
  threshold: number,
): Promise<EntityAboveThreshold[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.type, e.mention_count,
            COUNT(DISTINCT ie.item_id)::int AS item_count
     FROM entities e
     JOIN item_entities ie ON e.id = ie.entity_id
     WHERE e.type = ANY($1) AND e.confirmed = true
     GROUP BY e.id
     HAVING COUNT(DISTINCT ie.item_id) >= $2
     ORDER BY COUNT(DISTINCT ie.item_id) DESC`,
    [entityTypes, threshold],
  );
  return rows as EntityAboveThreshold[];
}
