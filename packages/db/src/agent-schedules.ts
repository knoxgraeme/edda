/**
 * Agent Schedules — CRUD and cron-runner queries
 *
 * Each row represents a single cron trigger for an agent, with its own
 * prompt (steering message) and optional context_mode override.
 */

import { getPool } from "./connection.js";
import type { AgentSchedule, AgentContextMode } from "./types.js";

const SCHEDULE_COLS = `id, agent_id, name, cron, prompt, context_mode, enabled, created_at`;

/** Schedule row joined with its parent agent's name. */
export interface EnabledSchedule extends AgentSchedule {
  agent_name: string;
}

/**
 * Get all enabled schedules with their parent agent name.
 * Used by the cron runner to register per-schedule tasks.
 */
export async function getEnabledSchedules(): Promise<EnabledSchedule[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT s.id, s.agent_id, s.name, s.cron, s.prompt, s.context_mode, s.enabled, s.created_at, a.name AS agent_name
     FROM agent_schedules s
     JOIN agents a ON a.id = s.agent_id
     WHERE s.enabled = true AND a.enabled = true
     ORDER BY a.name, s.name`,
  );
  return rows as EnabledSchedule[];
}

export async function getSchedulesForAgent(agentId: string): Promise<AgentSchedule[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SCHEDULE_COLS} FROM agent_schedules WHERE agent_id = $1 ORDER BY name`,
    [agentId],
  );
  return rows as AgentSchedule[];
}

export async function getScheduleById(id: string): Promise<AgentSchedule | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SCHEDULE_COLS} FROM agent_schedules WHERE id = $1`,
    [id],
  );
  return (rows[0] as AgentSchedule) ?? null;
}

export async function createSchedule(input: {
  agent_id: string;
  name: string;
  cron: string;
  prompt: string;
  context_mode?: AgentContextMode;
}): Promise<AgentSchedule> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agent_schedules (agent_id, name, cron, prompt, context_mode)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SCHEDULE_COLS}`,
    [
      input.agent_id,
      input.name,
      input.cron,
      input.prompt,
      input.context_mode ?? null,
    ],
  );
  return rows[0] as AgentSchedule;
}

export async function updateSchedule(
  id: string,
  updates: Partial<Pick<AgentSchedule, "cron" | "prompt" | "context_mode" | "enabled">>,
): Promise<AgentSchedule> {
  const pool = getPool();
  const SCHEDULE_UPDATE_COLUMNS = ["cron", "prompt", "context_mode", "enabled"] as const;
  const entries = Object.entries(updates).filter(
    ([k, v]) =>
      v !== undefined &&
      SCHEDULE_UPDATE_COLUMNS.includes(k as (typeof SCHEDULE_UPDATE_COLUMNS)[number]),
  );
  if (entries.length === 0) {
    const existing = await getScheduleById(id);
    if (!existing) throw new Error(`Schedule not found: ${id}`);
    return existing;
  }

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) => v);

  const { rows } = await pool.query(
    `UPDATE agent_schedules SET ${sets} WHERE id = $1 RETURNING ${SCHEDULE_COLS}`,
    [id, ...vals],
  );
  if (rows.length === 0) throw new Error(`Schedule not found: ${id}`);
  return rows[0] as AgentSchedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM agent_schedules WHERE id = $1`, [id]);
  if (rowCount === 0) throw new Error(`Schedule not found: ${id}`);
}
