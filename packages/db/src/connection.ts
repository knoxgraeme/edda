/**
 * Database connection pool — extracted to break circular imports.
 *
 * Query modules import getPool from here (not index.ts),
 * while index.ts re-exports everything including this module.
 */

import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    pool = new Pool({ connectionString, connectionTimeoutMillis: 30_000 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
