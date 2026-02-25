/**
 * MCP connection management
 */

import { getPool } from "./connection.js";
import type { McpConnection } from "./types.js";

export async function getMcpConnections(): Promise<McpConnection[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM mcp_connections WHERE enabled = true ORDER BY name",
  );
  return rows as McpConnection[];
}

export async function createMcpConnection(input: {
  name: string;
  transport: McpConnection["transport"];
  config: Record<string, unknown>;
}): Promise<McpConnection> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO mcp_connections (name, transport, config)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.name, input.transport, JSON.stringify(input.config)],
  );
  return rows[0] as McpConnection;
}

const MCP_UPDATE_COLUMNS = ['name', 'transport', 'config', 'enabled', 'discovered_tools'] as const;

export async function updateMcpConnection(
  id: string,
  updates: Partial<McpConnection>,
): Promise<McpConnection | null> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(
    ([k]) => MCP_UPDATE_COLUMNS.includes(k as typeof MCP_UPDATE_COLUMNS[number])
  );
  if (entries.length === 0) {
    const { rows } = await pool.query("SELECT * FROM mcp_connections WHERE id = $1", [id]);
    return (rows[0] as McpConnection) ?? null;
  }

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v));

  const { rows } = await pool.query(
    `UPDATE mcp_connections SET ${sets} WHERE id = $1 RETURNING *`,
    [id, ...vals],
  );
  return (rows[0] as McpConnection) ?? null;
}

export async function getAllMcpTools(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT unnest(discovered_tools) AS tool FROM mcp_connections WHERE enabled = true",
  );
  return rows.map((r: { tool: string }) => r.tool);
}

export async function deleteMcpConnection(id: string): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM mcp_connections WHERE id = $1", [id]);
}
