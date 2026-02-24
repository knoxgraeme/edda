/**
 * Agent Definitions CRUD
 *
 * Single source of truth for all agents — system and user-created.
 */

import { getPool } from "./connection.js";
import type { AgentContextMode, AgentDefinition, AgentOutputMode, AgentScopeMode } from "./types.js";

const AGENT_DEF_COLS = `id, name, description, system_prompt, skills, schedule,
  context_mode, output_mode, scopes, scope_mode, model_settings_key,
  built_in, enabled, metadata, created_at, updated_at`;

export async function getAgentDefinitions(
  opts?: { enabled?: boolean; built_in?: boolean },
): Promise<AgentDefinition[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.enabled !== undefined) {
    conditions.push(`enabled = $${idx++}`);
    params.push(opts.enabled);
  }
  if (opts?.built_in !== undefined) {
    conditions.push(`built_in = $${idx++}`);
    params.push(opts.built_in);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${AGENT_DEF_COLS} FROM agent_definitions ${where} ORDER BY name`,
    params,
  );
  return rows as AgentDefinition[];
}

export async function getAgentDefinitionByName(name: string): Promise<AgentDefinition | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${AGENT_DEF_COLS} FROM agent_definitions WHERE name = $1`,
    [name],
  );
  return (rows[0] as AgentDefinition) ?? null;
}

export async function getScheduledAgents(): Promise<AgentDefinition[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${AGENT_DEF_COLS} FROM agent_definitions
     WHERE enabled = true AND schedule IS NOT NULL
     ORDER BY name`,
  );
  return rows as AgentDefinition[];
}

export async function createAgentDefinition(input: {
  name: string;
  description: string;
  system_prompt?: string;
  skills?: string[];
  schedule?: string;
  context_mode?: AgentContextMode;
  output_mode?: AgentOutputMode;
  scopes?: string[];
  scope_mode?: AgentScopeMode;
  model_settings_key?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentDefinition> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agent_definitions
       (name, description, system_prompt, skills, schedule, context_mode,
        output_mode, scopes, scope_mode, model_settings_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${AGENT_DEF_COLS}`,
    [
      input.name,
      input.description,
      input.system_prompt ?? null,
      input.skills ?? [],
      input.schedule ?? null,
      input.context_mode ?? "isolated",
      input.output_mode ?? "channel",
      input.scopes ?? [],
      input.scope_mode ?? "boost",
      input.model_settings_key ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return rows[0] as AgentDefinition;
}

const AGENT_DEF_UPDATE_COLUMNS = [
  "description",
  "system_prompt",
  "skills",
  "schedule",
  "context_mode",
  "output_mode",
  "scopes",
  "scope_mode",
  "model_settings_key",
  "enabled",
  "metadata",
] as const;

export async function updateAgentDefinition(
  id: string,
  updates: Partial<
    Pick<
      AgentDefinition,
      | "description"
      | "system_prompt"
      | "skills"
      | "schedule"
      | "context_mode"
      | "output_mode"
      | "scopes"
      | "scope_mode"
      | "model_settings_key"
      | "enabled"
      | "metadata"
    >
  >,
): Promise<AgentDefinition> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(([k]) =>
    AGENT_DEF_UPDATE_COLUMNS.includes(k as (typeof AGENT_DEF_UPDATE_COLUMNS)[number]),
  );
  if (entries.length === 0) {
    const { rows: check } = await pool.query(
      `SELECT ${AGENT_DEF_COLS} FROM agent_definitions WHERE id = $1`,
      [id],
    );
    if (check.length === 0) throw new Error(`Agent definition not found: ${id}`);
    return check[0] as AgentDefinition;
  }

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([k, v]) => {
    if (k === "metadata") return JSON.stringify(v);
    return v;
  });

  const { rows } = await pool.query(
    `UPDATE agent_definitions SET ${sets} WHERE id = $1 RETURNING ${AGENT_DEF_COLS}`,
    [id, ...vals],
  );
  if (rows.length === 0) throw new Error(`Agent definition not found: ${id}`);
  return rows[0] as AgentDefinition;
}

export async function deleteAgentDefinition(id: string): Promise<void> {
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT built_in FROM agent_definitions WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw new Error(`Agent definition not found: ${id}`);
  if (rows[0].built_in) throw new Error("Cannot delete a built-in agent definition");

  await pool.query(`DELETE FROM agent_definitions WHERE id = $1`, [id]);
}
