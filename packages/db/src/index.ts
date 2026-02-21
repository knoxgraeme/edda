/**
 * @edda/db — Database client and query helpers
 *
 * Single Postgres connection pool shared across the application.
 * All queries go through this module.
 */

import { Pool } from "pg";

export * from "./types.js";
export * from "./items.js";
export * from "./entities.js";
export * from "./settings.js";
export * from "./item-types.js";
export * from "./dashboard.js";
export * from "./mcp-connections.js";
export * from "./agent-log.js";
export * from "./threads.js";
export * from "./confirmations.js";

// ──────────────────────────────────────────────
// Connection
// ──────────────────────────────────────────────

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
