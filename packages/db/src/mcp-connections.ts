/**
 * MCP connection management
 */

import { getPool } from "./index.js";
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
