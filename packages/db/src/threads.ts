/**
 * Thread metadata — tracks processing state for post-processing hooks.
 *
 * Works with the LangGraph checkpointer's `checkpoints` table.
 * The checkpointer stores a `metadata` JSONB column per checkpoint;
 * we use a lightweight `thread_metadata` approach: our own small table
 * that the afterAgent hook writes to and the daily cron reads from.
 * This avoids coupling to the checkpointer's internal schema.
 */

import { getPool } from "./connection.js";

export async function upsertThread(threadId: string, agentName?: string): Promise<void> {
  const pool = getPool();
  if (agentName) {
    await pool.query(
      `INSERT INTO thread_metadata (thread_id, agent_name) VALUES ($1, $2)
       ON CONFLICT (thread_id) DO UPDATE SET
         agent_name = COALESCE(thread_metadata.agent_name, $2),
         updated_at = now()`,
      [threadId, agentName],
    );
  } else {
    await pool.query(
      `INSERT INTO thread_metadata (thread_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [threadId],
    );
  }
}

export async function setThreadMetadata(
  threadId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO thread_metadata (thread_id, metadata)
     VALUES ($1, $2)
     ON CONFLICT (thread_id) DO UPDATE SET
       metadata = thread_metadata.metadata || $2,
       updated_at = now()`,
    [threadId, JSON.stringify(metadata)],
  );
}

export async function listThreads(limit: number = 50, agentName?: string): Promise<
  { thread_id: string; title: string | null; metadata: Record<string, unknown>; updated_at: Date }[]
> {
  const pool = getPool();
  if (agentName) {
    const { rows } = await pool.query(
      `SELECT thread_id, title, metadata, updated_at FROM thread_metadata
       WHERE agent_name = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [agentName, limit],
    );
    return rows as {
      thread_id: string;
      title: string | null;
      metadata: Record<string, unknown>;
      updated_at: Date;
    }[];
  }
  const { rows } = await pool.query(
    `SELECT thread_id, title, metadata, updated_at FROM thread_metadata
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows as {
    thread_id: string;
    title: string | null;
    metadata: Record<string, unknown>;
    updated_at: Date;
  }[];
}

export async function setThreadTitle(threadId: string, title: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE thread_metadata SET title = $2, updated_at = now()
     WHERE thread_id = $1 AND title IS NULL`,
    [threadId, title],
  );
}

export async function getUnprocessedThreads(limit: number = 100): Promise<
  { thread_id: string; metadata: Record<string, unknown> }[]
> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT thread_id, metadata FROM thread_metadata
     WHERE (metadata->>'processed_by_hook')::boolean IS NOT TRUE
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows as { thread_id: string; metadata: Record<string, unknown> }[];
}
