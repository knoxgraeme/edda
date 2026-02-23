/**
 * AGENTS.md versioned storage — DB-backed user context document
 *
 * Each row in agents_md_versions is a complete version of the curated
 * AGENTS.md content. The system prompt reads the latest version directly.
 */

import { getPool } from "./connection.js";
import type { AgentsMdVersion } from "./types.js";

/** Get the latest AGENTS.md version (most recent row). */
export async function getLatestAgentsMd(): Promise<AgentsMdVersion | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, content, template, input_hash, created_at
     FROM agents_md_versions ORDER BY id DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** Save a new AGENTS.md version. Returns the inserted row. */
export async function saveAgentsMdVersion(
  content: string,
  template: string,
  inputHash: string,
): Promise<AgentsMdVersion> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agents_md_versions (content, template, input_hash)
     VALUES ($1, $2, $3)
     RETURNING id, content, template, input_hash, created_at`,
    [content, template, inputHash],
  );
  return rows[0];
}

/** Prune old versions, keeping the most recent `keepCount` rows. */
export async function pruneAgentsMdVersions(keepCount: number): Promise<void> {
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new Error(`pruneAgentsMdVersions: keepCount must be >= 1, got ${keepCount}`);
  }
  const pool = getPool();
  await pool.query(
    `DELETE FROM agents_md_versions
     WHERE id NOT IN (
       SELECT id FROM agents_md_versions ORDER BY id DESC LIMIT $1
     )`,
    [keepCount],
  );
}

/** Shorthand: get just the content string from the latest version. */
export async function getAgentsMdContent(): Promise<string> {
  const latest = await getLatestAgentsMd();
  return latest?.content ?? "";
}
