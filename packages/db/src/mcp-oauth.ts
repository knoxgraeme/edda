/**
 * MCP OAuth state management — CRUD for mcp_oauth_state table.
 *
 * Stores/retrieves opaque encrypted strings — no crypto logic here.
 * State params are stored as SHA-256 hashes for defense-in-depth.
 */

import { createHash } from "crypto";
import { getPool } from "./connection.js";
import type { McpOAuthStateRow } from "./types.js";

export async function getOAuthState(connectionId: string): Promise<McpOAuthStateRow | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM mcp_oauth_state WHERE connection_id = $1",
    [connectionId],
  );
  return (rows[0] as McpOAuthStateRow) ?? null;
}

const OAUTH_STATE_COLUMNS: ReadonlySet<string> = new Set([
  "client_info_encrypted",
  "tokens_encrypted",
  "expires_at",
  "discovery_state",
  "pending_auth",
]);

export async function upsertOAuthState(
  connectionId: string,
  patch: Partial<Omit<McpOAuthStateRow, "connection_id" | "created_at" | "updated_at">>,
): Promise<void> {
  const pool = getPool();

  const entries = Object.entries(patch).filter(
    ([k, v]) => v !== undefined && OAUTH_STATE_COLUMNS.has(k),
  );
  if (entries.length === 0) return;

  const columns = entries.map(([k]) => k);
  const values = entries.map(([k, v]) =>
    k === "pending_auth" || k === "discovery_state" ? JSON.stringify(v) : v,
  );

  const insertCols = ["connection_id", ...columns].join(", ");
  const insertVals = ["$1", ...columns.map((_, i) => `$${i + 2}`)].join(", ");
  const updateSets = columns.map((k, i) => `"${k}" = $${i + 2}`).join(", ");

  await pool.query(
    `INSERT INTO mcp_oauth_state (${insertCols})
     VALUES (${insertVals})
     ON CONFLICT (connection_id) DO UPDATE SET ${updateSets}, updated_at = now()`,
    [connectionId, ...values],
  );
}

export async function findConnectionByStateParam(stateParam: string): Promise<string | null> {
  const pool = getPool();
  // State params are stored as SHA-256 hashes — hash the raw value before lookup
  const stateHash = createHash("sha256").update(stateParam).digest("hex");
  const { rows } = await pool.query(
    `SELECT connection_id FROM mcp_oauth_state
     WHERE pending_auth->>'state_param' = $1`,
    [stateHash],
  );
  return (rows[0] as { connection_id: string })?.connection_id ?? null;
}
