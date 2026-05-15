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

/**
 * Returns a 7-element array per agent: run counts for each of the last 7
 * calendar days (UTC), oldest first. Days with no runs are 0.
 *
 * Both the SQL bucketing and the JS bucket index are pinned to UTC so the
 * date keys match regardless of the Postgres session timezone or the Node
 * process timezone.
 */
export async function getRunsLast7DaysPerAgent(): Promise<Record<string, number[]>> {
  const pool = getPool();
  const { rows } = await pool.query<{ agent_name: string; day: string; runs: number }>(
    `SELECT agent_name,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS runs
     FROM task_runs
     WHERE created_at >= (now() AT TIME ZONE 'UTC')::date - INTERVAL '6 days'
     GROUP BY agent_name, day`,
  );

  const buckets: string[] = [];
  const todayUtc = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate() - i,
    ));
    buckets.push(d.toISOString().slice(0, 10));
  }

  const result: Record<string, number[]> = {};
  for (const row of rows) {
    if (!result[row.agent_name]) result[row.agent_name] = new Array(7).fill(0);
    const idx = buckets.indexOf(row.day);
    if (idx >= 0) result[row.agent_name][idx] = row.runs;
  }
  return result;
}
