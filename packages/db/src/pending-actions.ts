/**
 * Pending Actions — CRUD and lifecycle queries for the pending_actions table.
 */

import { getPool } from "./connection.js";
import type { PendingAction, PendingActionStatus } from "./types.js";

const COLS = `id, agent_name, tool_name, tool_input, description, status, thread_id, run_context, resolved_by, resolved_at, expires_at, channel_refs, created_at`;

export async function createPendingAction(input: {
  agent_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  description: string;
  thread_id?: string | null;
  run_context?: Record<string, unknown>;
  ttl?: string; // PostgreSQL interval, default '1 hour'
}): Promise<PendingAction> {
  const pool = getPool();
  const ttl = input.ttl ?? "1 hour";
  const { rows } = await pool.query(
    `INSERT INTO pending_actions (agent_name, tool_name, tool_input, description, thread_id, run_context, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + $7::interval)
     RETURNING ${COLS}`,
    [
      input.agent_name,
      input.tool_name,
      JSON.stringify(input.tool_input),
      input.description,
      input.thread_id ?? null,
      JSON.stringify(input.run_context ?? {}),
      ttl,
    ],
  );
  return rows[0] as PendingAction;
}

export async function getPendingAction(id: string): Promise<PendingAction | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM pending_actions WHERE id = $1`,
    [id],
  );
  return (rows[0] as PendingAction) ?? null;
}

export async function listPendingActions(opts?: {
  agent_name?: string;
  status?: PendingActionStatus;
  limit?: number;
}): Promise<PendingAction[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.agent_name) {
    conditions.push(`agent_name = $${idx++}`);
    params.push(opts.agent_name);
  }
  if (opts?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT ${COLS} FROM pending_actions ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );
  return rows as PendingAction[];
}

/**
 * Atomically resolve a pending action. Returns null if already resolved (race-safe).
 */
export async function resolvePendingAction(
  id: string,
  decision: "approved" | "rejected",
  resolvedBy: string,
): Promise<PendingAction | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE pending_actions
     SET status = $2, resolved_by = $3, resolved_at = now()
     WHERE id = $1 AND status = 'pending' AND expires_at > now()
     RETURNING ${COLS}`,
    [id, decision, resolvedBy],
  );
  return (rows[0] as PendingAction) ?? null;
}

/**
 * Expire all pending actions past their TTL. Returns count of expired rows.
 */
export async function expirePendingActions(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE pending_actions SET status = 'expired' WHERE status = 'pending' AND expires_at <= now()`,
  );
  return rowCount ?? 0;
}

/**
 * Append a channel reference (sent confirmation message) to a pending action.
 */
export async function addChannelRef(
  id: string,
  ref: { platform: string; message_id: string; external_id: string },
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE pending_actions SET channel_refs = channel_refs || $2::jsonb WHERE id = $1`,
    [id, JSON.stringify([ref])],
  );
}
