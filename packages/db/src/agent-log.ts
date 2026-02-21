/**
 * Agent log — tracks skill executions, errors, and agent activity
 */

import { getPool } from "./connection.js";
import type { AgentLog, CreateAgentLogInput } from "./types.js";

export async function createAgentLog(input: CreateAgentLogInput): Promise<AgentLog> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agent_log (skill, trigger, input_summary, output_summary, items_created, items_retrieved, entities_created, model, tokens_in, tokens_out, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.skill,
      input.trigger,
      input.input_summary ?? null,
      input.output_summary ?? null,
      input.items_created ?? [],
      input.items_retrieved ?? [],
      input.entities_created ?? [],
      input.model ?? null,
      input.tokens_in ?? null,
      input.tokens_out ?? null,
      input.duration_ms ?? null,
    ],
  );
  return rows[0] as AgentLog;
}

export async function getRecentAgentLogs(
  options: { skill?: string; limit?: number } = {},
): Promise<AgentLog[]> {
  const pool = getPool();
  const { skill, limit = 50 } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (skill) {
    conditions.push(`skill = $${paramIdx++}`);
    params.push(skill);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT * FROM agent_log ${where} ORDER BY created_at DESC LIMIT $${paramIdx}`,
    [...params, limit],
  );
  return rows as AgentLog[];
}
