/**
 * Lightweight MCP probe for API routes.
 * Connects to an MCP server, lists its tools, and returns sanitized tool names.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpConnection } from "@edda/db";

const MCP_TIMEOUT_MS = parseInt(process.env.MCP_TIMEOUT_MS ?? "10000", 10);

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Probe an MCP server and return its tool names (without keeping the connection).
 * Returns an empty array on failure so callers can proceed without blocking.
 */
export async function probeMcpTools(connection: McpConnection): Promise<string[]> {
  const config = connection.config as Record<string, unknown>;
  let transport;

  switch (connection.transport) {
    case "stdio":
      transport = new StdioClientTransport({
        command: config.command as string,
        args: (config.args as string[]) ?? [],
      });
      break;
    case "sse":
      transport = new SSEClientTransport(new URL(config.url as string));
      break;
    case "streamable-http":
      transport = new StreamableHTTPClientTransport(new URL(config.url as string));
      break;
    default:
      return [];
  }

  const client = new Client({ name: "edda", version: "1.0.0" });

  try {
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, connection.name);
    const { tools } = await withTimeout(client.listTools(), MCP_TIMEOUT_MS, connection.name);
    return tools.map((t) => `mcp_${sanitizeName(connection.name)}_${sanitizeName(t.name)}`);
  } catch (err) {
    console.warn(`[MCP Probe] Failed to probe "${connection.name}": ${err}`);
    return [];
  } finally {
    await client.close().catch(() => {});
  }
}
