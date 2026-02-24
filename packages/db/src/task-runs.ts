/**
 * Task Runs — lifecycle tracking for every agent execution.
 */

import { getPool } from "./connection.js";
import type { TaskRun, TaskRunStatus, TaskRunTrigger } from "./types.js";

const TASK_RUN_COLS = `id, agent_definition_id, agent_name, trigger, status,
  thread_id, input_summary, output_summary, model, tokens_used,
  duration_ms, error, started_at, completed_at, created_at`;

export async function createTaskRun(input: {
  agent_definition_id?: string | null;
  agent_name: string;
  trigger: TaskRunTrigger;
  thread_id?: string;
  input_summary?: string;
  model?: string;
}): Promise<TaskRun> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO task_runs (agent_definition_id, agent_name, trigger, thread_id, input_summary, model)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${TASK_RUN_COLS}`,
    [
      input.agent_definition_id ?? null,
      input.agent_name,
      input.trigger,
      input.thread_id ?? null,
      input.input_summary ?? null,
      input.model ?? null,
    ],
  );
  return rows[0] as TaskRun;
}

export async function startTaskRun(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE task_runs SET status = 'running', started_at = now() WHERE id = $1`,
    [id],
  );
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
  await pool.query(
    `UPDATE task_runs
     SET status = 'completed', completed_at = now(),
         output_summary = COALESCE($2, output_summary),
         tokens_used = COALESCE($3, tokens_used),
         duration_ms = COALESCE($4, duration_ms)
     WHERE id = $1`,
    [id, output.output_summary ?? null, output.tokens_used ?? null, output.duration_ms ?? null],
  );
}

export async function failTaskRun(id: string, error: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE task_runs SET status = 'failed', completed_at = now(), error = $2 WHERE id = $1`,
    [id, error],
  );
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

export async function getRunningTaskCount(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM task_runs WHERE status = 'running'`,
  );
  return rows[0].count;
}
