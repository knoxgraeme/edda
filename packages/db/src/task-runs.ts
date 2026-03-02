/**
 * Task Runs — lifecycle tracking for every agent execution.
 */

import { getPool } from "./connection.js";
import type { TaskRun, TaskRunStatus, TaskRunTrigger } from "./types.js";

const TASK_RUN_COLS = `id, agent_id, agent_name, trigger, status,
  thread_id, schedule_id, input_summary, output_summary, model, tokens_used,
  duration_ms, error, started_at, completed_at, created_at`;

export async function createTaskRun(input: {
  agent_id?: string | null;
  agent_name: string;
  trigger: TaskRunTrigger;
  thread_id?: string;
  schedule_id?: string;
  input_summary?: string;
  model?: string;
}): Promise<TaskRun> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO task_runs (agent_id, agent_name, trigger, thread_id, schedule_id, input_summary, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${TASK_RUN_COLS}`,
    [
      input.agent_id ?? null,
      input.agent_name,
      input.trigger,
      input.thread_id ?? null,
      input.schedule_id ?? null,
      input.input_summary ?? null,
      input.model ?? null,
    ],
  );
  return rows[0] as TaskRun;
}

export async function createAndStartTaskRun(input: {
  agent_id?: string | null;
  agent_name: string;
  trigger: TaskRunTrigger;
  thread_id?: string;
  schedule_id?: string;
  input_summary?: string;
  model?: string;
}): Promise<TaskRun> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO task_runs
       (agent_id, agent_name, trigger, thread_id, schedule_id, input_summary, model,
        status, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', now())
     RETURNING ${TASK_RUN_COLS}`,
    [
      input.agent_id ?? null,
      input.agent_name,
      input.trigger,
      input.thread_id ?? null,
      input.schedule_id ?? null,
      input.input_summary ?? null,
      input.model ?? null,
    ],
  );
  return rows[0] as TaskRun;
}

export async function startTaskRun(id: string): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE task_runs SET status = 'running', started_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  if (rowCount === 0) {
    console.warn(`[task-runs] startTaskRun(${id}): no pending run found`);
  }
}

export async function completeTaskRun(
  id: string,
  output: {
    output_summary?: string;
    tokens_used?: number;
    duration_ms?: number;
  },
): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE task_runs
     SET status = 'completed', completed_at = now(),
         output_summary = COALESCE($2, output_summary),
         tokens_used = COALESCE($3, tokens_used),
         duration_ms = COALESCE($4, duration_ms)
     WHERE id = $1 AND status = 'running'`,
    [id, output.output_summary ?? null, output.tokens_used ?? null, output.duration_ms ?? null],
  );
  if (rowCount === 0) {
    console.warn(`[task-runs] completeTaskRun(${id}): no running run found`);
  }
}

export async function failTaskRun(id: string, error: string): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE task_runs SET status = 'failed', completed_at = now(), error = $2
     WHERE id = $1 AND status IN ('pending', 'running')`,
    [id, error],
  );
  if (rowCount === 0) {
    console.warn(`[task-runs] failTaskRun(${id}): no pending or running run found`);
  }
}

export async function getRecentTaskRuns(
  opts?: { agent_name?: string; status?: TaskRunStatus; limit?: number },
): Promise<TaskRun[]> {
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

  const limit = opts?.limit ?? 50;
  params.push(limit);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${TASK_RUN_COLS} FROM task_runs ${where}
     ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );
  return rows as TaskRun[];
}

export async function getTaskRunById(id: string): Promise<TaskRun | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM task_runs WHERE id = $1`, [id]);
  return (rows[0] as TaskRun) ?? null;
}

export async function getLatestRunPerAgent(): Promise<Record<string, TaskRun>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (agent_name) ${TASK_RUN_COLS}
     FROM task_runs
     ORDER BY agent_name, created_at DESC`,
  );
  return Object.fromEntries((rows as TaskRun[]).map((r) => [r.agent_name, r]));
}

export async function getRunningTaskCount(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM task_runs WHERE status = 'running'`,
  );
  return rows[0].count;
}

export interface AgentMetricsRow {
  agent_name: string;
  total: number;
  completed: number;
  failed: number;
  avg_duration_ms: number | null;
  total_tokens: number | null;
}

export async function getAgentMetrics(days = 7): Promise<AgentMetricsRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT agent_name,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            ROUND(AVG(duration_ms) FILTER (WHERE status = 'completed'))::int AS avg_duration_ms,
            SUM(tokens_used)::int AS total_tokens
     FROM task_runs
     WHERE created_at >= now() - make_interval(days => $1)
     GROUP BY agent_name
     ORDER BY total DESC`,
    [days],
  );
  return rows as AgentMetricsRow[];
}

export interface SystemMetrics {
  running_count: number;
  completed_24h: number;
  failed_24h: number;
  avg_duration_24h_ms: number | null;
  total_tokens_24h: number | null;
}

export async function deleteOldTaskRuns(retentionDays: number): Promise<number> {
  const pool = getPool();
  const BATCH = 500;
  let total = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rowCount } = await pool.query(
      `DELETE FROM task_runs
       WHERE id IN (
         SELECT id FROM task_runs
         WHERE status IN ('completed', 'failed', 'cancelled')
           AND created_at < now() - make_interval(days => $1)
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )`,
      [retentionDays, BATCH],
    );
    const deleted = rowCount ?? 0;
    total += deleted;
    if (deleted < BATCH) break;
  }

  return total;
}

export async function resetStuckRunningTaskRuns(thresholdMinutes = 10): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE task_runs
     SET status = 'failed', completed_at = now(), error = 'stuck_timeout'
     WHERE status = 'running'
       AND started_at < now() - make_interval(mins => $1)`,
    [thresholdMinutes],
  );
  return rowCount ?? 0;
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM task_runs WHERE status = 'running') AS running_count,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_24h,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_24h,
       ROUND(AVG(duration_ms) FILTER (WHERE status = 'completed'))::int AS avg_duration_24h_ms,
       SUM(tokens_used)::int AS total_tokens_24h
     FROM task_runs
     WHERE created_at >= now() - interval '24 hours'`,
  );
  return rows[0] as SystemMetrics;
}
