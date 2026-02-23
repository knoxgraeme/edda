/**
 * Memory Types — query functions for the memory_types table.
 */

import { getPool } from "./connection.js";
import type { MemoryType } from "./types.js";

export async function getMemoryTypes(): Promise<MemoryType[]> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM memory_types ORDER BY name");
  return rows as MemoryType[];
}

export async function getMemoryTypeByName(name: string): Promise<MemoryType | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM memory_types WHERE name = $1", [name]);
  return (rows[0] as MemoryType) ?? null;
}

export async function getMemoryTypeForEntityType(entityType: string): Promise<MemoryType | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM memory_types WHERE $1 = ANY(entity_types) LIMIT 1",
    [entityType],
  );
  return (rows[0] as MemoryType) ?? null;
}
