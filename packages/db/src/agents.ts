/**
 * Agents CRUD
 *
 * Single source of truth for all agents — system and user-created.
 */

import { getPool } from "./connection.js";
import type { Agent, AgentContextMode, AgentScopeMode, AgentTrigger } from "./types.js";

const AGENT_COLS = `id, name, description, system_prompt, skills, schedule,
  context_mode, trigger, tools, subagents, scopes, scope_mode, model_settings_key,
  enabled, metadata, created_at, updated_at`;

export async function getAgents(opts?: { enabled?: boolean }): Promise<Agent[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.enabled !== undefined) {
    conditions.push(`enabled = $${idx++}`);
    params.push(opts.enabled);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${AGENT_COLS} FROM agents ${where} ORDER BY name`,
    params,
  );
  return rows as Agent[];
}

export async function getAgentByName(name: string): Promise<Agent | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${AGENT_COLS} FROM agents WHERE name = $1`, [name]);
  return (rows[0] as Agent) ?? null;
}

export async function getScheduledAgents(): Promise<Agent[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${AGENT_COLS} FROM agents
     WHERE enabled = true AND schedule IS NOT NULL
     ORDER BY name`,
  );
  return rows as Agent[];
}

export async function createAgent(input: {
  name: string;
  description: string;
  system_prompt?: string;
  skills?: string[];
  schedule?: string;
  context_mode?: AgentContextMode;
  trigger?: AgentTrigger;
  tools?: string[];
  subagents?: string[];
  scopes?: string[];
  scope_mode?: AgentScopeMode;
  model_settings_key?: string;
  metadata?: Record<string, unknown>;
}): Promise<Agent> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agents
       (name, description, system_prompt, skills, schedule, context_mode,
        trigger, tools, subagents, scopes, scope_mode, model_settings_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${AGENT_COLS}`,
    [
      input.name,
      input.description,
      input.system_prompt ?? null,
      input.skills ?? [],
      input.schedule ?? null,
      input.context_mode ?? "isolated",
      input.trigger ?? null,
      input.tools ?? [],
      input.subagents ?? [],
      input.scopes ?? [],
      input.scope_mode ?? "boost",
      input.model_settings_key ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return rows[0] as Agent;
}

const AGENT_UPDATE_COLUMNS = [
  "description",
  "system_prompt",
  "skills",
  "schedule",
  "context_mode",
  "trigger",
  "tools",
  "subagents",
  "scopes",
  "scope_mode",
  "model_settings_key",
  "enabled",
  "metadata",
] as const;

export async function updateAgent(
  id: string,
  updates: Partial<
    Pick<
      Agent,
      | "description"
      | "system_prompt"
      | "skills"
      | "schedule"
      | "context_mode"
      | "trigger"
      | "tools"
      | "subagents"
      | "scopes"
      | "scope_mode"
      | "model_settings_key"
      | "enabled"
      | "metadata"
    >
  >,
): Promise<Agent> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(([k]) =>
    AGENT_UPDATE_COLUMNS.includes(k as (typeof AGENT_UPDATE_COLUMNS)[number]),
  );
  if (entries.length === 0) {
    const { rows: check } = await pool.query(
      `SELECT ${AGENT_COLS} FROM agents WHERE id = $1`,
      [id],
    );
    if (check.length === 0) throw new Error(`Agent not found: ${id}`);
    return check[0] as Agent;
  }

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([k, v]) => {
    if (k === "metadata") return JSON.stringify(v);
    return v;
  });

  const { rows } = await pool.query(
    `UPDATE agents SET ${sets} WHERE id = $1 RETURNING ${AGENT_COLS}`,
    [id, ...vals],
  );
  if (rows.length === 0) throw new Error(`Agent not found: ${id}`);
  return rows[0] as Agent;
}

export async function deleteAgent(id: string): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM agents WHERE id = $1`, [id]);
  if (rowCount === 0) throw new Error(`Agent not found: ${id}`);
}