/**
 * Agent Schedules — CRUD and cron-runner queries
 *
 * Each row represents a single cron trigger for an agent, with its own
 * prompt (steering message) and optional thread_lifetime override.
 */

import { getPool } from "./connection.js";
import type { AgentSchedule, ThreadLifetime } from "./types.js";

const SCHEDULE_COLS = `id, agent_id, name, cron, prompt, thread_lifetime, notify, notify_expires_after::text, enabled, created_at::text`;

/**
 * Normalize pg interval::text (e.g. "72:00:00") to human form (e.g. "72 hours").
 * Handles already-human values like "72 hours" as a passthrough.
 */
function normalizeInterval(row: Record<string, unknown>): void {
  const v = row.notify_expires_after;
  if (typeof v !== "string") return;
  const match = v.match(/^(\d+):00:00$/);
  if (match) {
    const h = parseInt(match[1], 10);
    row.notify_expires_after = `${h} hour${h !== 1 ? "s" : ""}`;
  }
}

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
    `SELECT s.id, s.agent_id, s.name, s.cron, s.prompt, s.thread_lifetime, s.notify, s.notify_expires_after::text, s.enabled, s.created_at::text, a.name AS agent_name
     FROM agent_schedules s
     JOIN agents a ON a.id = s.agent_id
     WHERE s.enabled = true AND a.enabled = true
     ORDER BY a.name, s.name`,
  );
  for (const row of rows) normalizeInterval(row as Record<string, unknown>);
  return rows as EnabledSchedule[];
}

export async function getSchedulesForAgent(agentId: string): Promise<AgentSchedule[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SCHEDULE_COLS} FROM agent_schedules WHERE agent_id = $1 ORDER BY name`,
    [agentId],
  );
  for (const row of rows) normalizeInterval(row as Record<string, unknown>);
  return rows as AgentSchedule[];
}

export async function getScheduleById(id: string): Promise<AgentSchedule | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SCHEDULE_COLS} FROM agent_schedules WHERE id = $1`,
    [id],
  );
  if (rows[0]) normalizeInterval(rows[0] as Record<string, unknown>);
  return (rows[0] as AgentSchedule) ?? null;
}

export async function createSchedule(input: {
  agent_id: string;
  name: string;
  cron: string;
  prompt: string;
  thread_lifetime?: ThreadLifetime;
  notify?: string[];
  notify_expires_after?: string | null;
}): Promise<AgentSchedule> {
  const pool = getPool();
  // notify_expires_after: undefined = use DB default (72 hours), null = no expiry
  const hasExpires = input.notify_expires_after !== undefined;
  const cols = hasExpires
    ? `agent_id, name, cron, prompt, thread_lifetime, notify, notify_expires_after`
    : `agent_id, name, cron, prompt, thread_lifetime, notify`;
  const placeholders = hasExpires
    ? `$1, $2, $3, $4, $5, $6, $7::interval`
    : `$1, $2, $3, $4, $5, $6`;
  const params: unknown[] = [
    input.agent_id,
    input.name,
    input.cron,
    input.prompt,
    input.thread_lifetime ?? null,
    input.notify ?? [],
  ];
  if (hasExpires) params.push(input.notify_expires_after);
  const { rows } = await pool.query(
    `INSERT INTO agent_schedules (${cols})
     VALUES (${placeholders})
     RETURNING ${SCHEDULE_COLS}`,
    params,
  );
  return rows[0] as AgentSchedule;
}

export async function updateSchedule(
  id: string,
  updates: Partial<
    Pick<AgentSchedule, "cron" | "prompt" | "thread_lifetime" | "notify" | "notify_expires_after" | "enabled">
  >,
): Promise<AgentSchedule> {
  const pool = getPool();
  const SCHEDULE_UPDATE_COLUMNS = [
    "cron",
    "prompt",
    "thread_lifetime",
    "notify",
    "notify_expires_after",
    "enabled",
  ] as const;
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
