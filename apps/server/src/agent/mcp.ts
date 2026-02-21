/**
 * MCP tool loader — discovers and wraps MCP server tools for LangChain
 *
 * Reads enabled MCP connections from the database, connects to each server,
 * discovers available tools, and converts them to LangChain DynamicStructuredTool
 * instances. Connection failures are logged and skipped gracefully.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getMcpConnections } from "@edda/db";
import type { McpConnection } from "@edda/db";

/** Active MCP clients, keyed by connection ID. Used for lifecycle management. */
const activeClients = new Map<string, Client>();

function createTransport(connection: McpConnection) {
  const config = connection.config;

  switch (connection.transport) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command as string,
        args: (config.args as string[]) ?? [],
        env: (config.env as Record<string, string>) ?? undefined,
      });

    case "sse": {
      const authToken = config.auth_env_var
        ? process.env[config.auth_env_var as string]
        : undefined;
      if (authToken) {
        return new SSEClientTransport(new URL(config.url as string), {
          requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
          eventSourceInit: {
            fetch: (url, init) =>
              fetch(url, {
                ...init,
                headers: { ...((init?.headers as Record<string, string>) ?? {}), Authorization: `Bearer ${authToken}` },
              }),
          },
        });
      }
      return new SSEClientTransport(new URL(config.url as string));
    }

    case "streamable-http":
      return new StreamableHTTPClientTransport(new URL(config.url as string));

    default:
      throw new Error(`Unsupported MCP transport: ${connection.transport}`);
  }
}

/**
 * Load tools from all enabled MCP connections.
 * Returns an array of LangChain-compatible tools.
 */
export async function loadMCPTools(): Promise<DynamicStructuredTool[]> {
  const connections = await getMcpConnections();

  if (connections.length === 0) return [];

  const results = await Promise.allSettled(
    connections.map((conn) => loadToolsFromConnection(conn)),
  );

  const tools: DynamicStructuredTool[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      tools.push(...result.value);
    } else {
      console.warn(
        `[MCP] Failed to load tools from "${connections[i].name}": ${result.reason}`,
      );
    }
  }

  if (tools.length > 0) {
    console.log(`[MCP] Loaded ${tools.length} tools from ${connections.length} connections`);
  }

  return tools;
}

/**
 * Close all active MCP client connections. Call during server shutdown.
 */
export async function closeMCPClients(): Promise<void> {
  const closePromises = [...activeClients.entries()].map(async ([id, client]) => {
    try {
      await client.close();
    } catch (err) {
      console.warn(`[MCP] Error closing client "${id}": ${err}`);
    }
  });
  await Promise.allSettled(closePromises);
  activeClients.clear();
}

async function loadToolsFromConnection(
  connection: McpConnection,
): Promise<DynamicStructuredTool[]> {
  const transport = createTransport(connection);
  const client = new Client({ name: "edda", version: "1.0.0" });

  await client.connect(transport);
  activeClients.set(connection.id, client);

  const { tools: mcpTools } = await client.listTools();

  return mcpTools.map((tool) => {
    const schemaInfo = tool.inputSchema
      ? `\n\nInput schema: ${JSON.stringify(tool.inputSchema)}`
      : "";

    return new DynamicStructuredTool({
      name: `mcp_${sanitizeName(connection.name)}_${sanitizeName(tool.name)}`,
      description:
        (tool.description ?? `MCP tool from ${connection.name}`) + schemaInfo,
      schema: z.record(z.unknown()),
      func: async (input) => {
        const result = await client.callTool({
          name: tool.name,
          arguments: input,
        });
        return JSON.stringify(result.content);
      },
    });
  });
}

/** Sanitize a name for use in tool identifiers (alphanumeric + underscores) */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}
