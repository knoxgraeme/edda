/**
 * Agents CRUD
 *
 * Single source of truth for all agents — system and user-created.
 */

import { getPool } from "./connection.js";
import type { Agent, ThreadLifetime, ThreadScope, AgentTrigger } from "./types.js";

const AGENT_COLS = `id, name, description, system_prompt, skills,
  thread_lifetime, thread_scope, trigger, tools, subagents, model_provider,
  model, enabled, memory_capture, memory_self_reflect, metadata,
  created_at, updated_at`;

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

export async function getAgentById(id: string): Promise<Agent | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${AGENT_COLS} FROM agents WHERE id = $1`, [id]);
  return (rows[0] as Agent) ?? null;
}

export async function getAgentByName(name: string): Promise<Agent | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${AGENT_COLS} FROM agents WHERE name = $1`, [name]);
  return (rows[0] as Agent) ?? null;
}

export async function getAgentsByNames(names: string[]): Promise<Agent[]> {
  if (names.length === 0) return [];
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${AGENT_COLS} FROM agents WHERE name = ANY($1)`,
    [names],
  );
  return rows as Agent[];
}

export async function createAgent(input: {
  name: string;
  description: string;
  system_prompt?: string;
  skills?: string[];
  thread_lifetime?: ThreadLifetime;
  thread_scope?: ThreadScope;
  trigger?: AgentTrigger;
  tools?: string[];
  subagents?: string[];
  model_provider?: string | null;
  model?: string | null;
  memory_capture?: boolean;
  memory_self_reflect?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<Agent> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agents
       (name, description, system_prompt, skills, thread_lifetime, thread_scope,
        trigger, tools, subagents, model_provider, model,
        memory_capture, memory_self_reflect, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${AGENT_COLS}`,
    [
      input.name,
      input.description,
      input.system_prompt ?? null,
      input.skills ?? [],
      input.thread_lifetime ?? "ephemeral",
      input.thread_scope ?? "shared",
      input.trigger ?? null,
      input.tools ?? [],
      input.subagents ?? [],
      input.model_provider ?? null,
      input.model ?? null,
      input.memory_capture ?? true,
      input.memory_self_reflect ?? true,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return rows[0] as Agent;
}

const AGENT_UPDATE_COLUMNS = [
  "description",
  "system_prompt",
  "skills",
  "thread_lifetime",
  "thread_scope",
  "trigger",
  "tools",
  "subagents",
  "model_provider",
  "model",
  "enabled",
  "memory_capture",
  "memory_self_reflect",
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
      | "thread_lifetime"
      | "thread_scope"
      | "trigger"
      | "tools"
      | "subagents"
      | "model_provider"
      | "model"
      | "enabled"
      | "memory_capture"
      | "memory_self_reflect"
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

export async function getAgentNames(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT name FROM agents ORDER BY name`);
  return rows.map((r: { name: string }) => r.name);
}

/**
 * Atomically add/remove tool names on an agent's tools[] array.
 * Uses array_cat / array_remove to avoid read-modify-write races.
 */
export async function modifyAgentTools(
  id: string,
  opts: { add?: string[]; remove?: string[] },
): Promise<Agent> {
  const pool = getPool();

  // Build SET clause: add first, then remove
  let expr = "tools";
  const params: unknown[] = [id];
  let idx = 2;

  if (opts.add?.length) {
    // array_cat appends; wrap in SELECT DISTINCT unnest to deduplicate
    expr = `(SELECT ARRAY(SELECT DISTINCT unnest(array_cat(${expr}, $${idx}::text[]))))`;
    params.push(opts.add);
    idx++;
  }
  if (opts.remove?.length) {
    for (const name of opts.remove) {
      expr = `array_remove(${expr}, $${idx})`;
      params.push(name);
      idx++;
    }
  }

  const { rows } = await pool.query(
    `UPDATE agents SET tools = ${expr} WHERE id = $1 RETURNING ${AGENT_COLS}`,
    params,
  );
  if (rows.length === 0) throw new Error(`Agent not found: ${id}`);
  return rows[0] as Agent;
}

export async function deleteAgent(id: string): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM agents WHERE id = $1`, [id]);
  if (rowCount === 0) throw new Error(`Agent not found: ${id}`);
}