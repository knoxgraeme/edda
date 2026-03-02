/**
 * AGENTS.md versioned storage — DB-backed user context document
 *
 * Each row in agents_md_versions is a complete version of the curated
 * AGENTS.md content. The system prompt reads the latest version directly.
 * Scoped by agent_name to support per-agent context documents.
 */

import { getPool } from "./connection.js";
import type { AgentsMdVersion } from "./types.js";

/** Get the latest AGENTS.md version for an agent (most recent row). */
export async function getLatestAgentsMd(
  agentName = "edda",
): Promise<AgentsMdVersion | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, content, template, input_hash, agent_name, created_at
     FROM agents_md_versions
     WHERE agent_name = $1
     ORDER BY id DESC LIMIT 1`,
    [agentName],
  );
  return (rows[0] as AgentsMdVersion) ?? null;
}

/** Save a new AGENTS.md version. */
export async function saveAgentsMdVersion(input: {
  content: string;
  agentName?: string;
}): Promise<AgentsMdVersion> {
  const pool = getPool();
  const agentName = input.agentName ?? "edda";
  const { rows } = await pool.query(
    `INSERT INTO agents_md_versions (content, template, input_hash, agent_name)
     VALUES ($1, '', NULL, $2)
     RETURNING id, content, template, input_hash, agent_name, created_at`,
    [input.content, agentName],
  );
  return rows[0] as AgentsMdVersion;
}

/** Prune old versions, keeping the most recent `keepCount` rows per agent. */
export async function pruneAgentsMdVersions(keepCount: number): Promise<void> {
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new Error(`pruneAgentsMdVersions: keepCount must be >= 1, got ${keepCount}`);
  }
  const pool = getPool();
  await pool.query(
    `DELETE FROM agents_md_versions
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY agent_name ORDER BY id DESC) AS rn
         FROM agents_md_versions
       ) ranked
       WHERE rn <= $1
     )`,
    [keepCount],
  );
}

/** Shorthand: get just the content string from the latest version. */
export async function getAgentsMdContent(agentName = "edda"): Promise<string> {
  const latest = await getLatestAgentsMd(agentName);
  return latest?.content ?? "";
}
