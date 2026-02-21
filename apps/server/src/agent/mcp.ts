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

const MCP_TIMEOUT_MS = parseInt(process.env.MCP_TIMEOUT_MS ?? "10000", 10);

// --- Config validation schemas ---

const stdioConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

const sseConfigSchema = z.object({
  url: z.string(),
  auth_env_var: z.string().optional(),
});

const streamableHttpConfigSchema = z.object({
  url: z.string(),
});

// --- Stdio security: command allowlist + env filtering ---

const ALLOWED_STDIO_COMMANDS = new Set(["node", "npx", "python", "python3", "uvx", "deno"]);

const BLOCKED_ENV_KEYS = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "HOME",
  "SHELL",
]);

function sanitizeEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(Object.entries(env).filter(([k]) => !BLOCKED_ENV_KEYS.has(k)));
}

// --- JSON Schema → Zod conversion ---

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  if (!schema || !schema.properties) return z.record(z.unknown());

  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodType;
    switch (prop.type) {
      case "string":
        field = z.string();
        break;
      case "number":
      case "integer":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "array":
        field = z.array(z.unknown());
        break;
      case "object":
        field = z.record(z.unknown());
        break;
      default:
        field = z.unknown();
        break;
    }
    if (prop.description) field = field.describe(prop.description as string);
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }

  return z.object(shape);
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

function createTransport(connection: McpConnection) {
  const config = connection.config;

  switch (connection.transport) {
    case "stdio": {
      const parsed = stdioConfigSchema.parse(config);
      const command = parsed.command.split("/").pop() ?? parsed.command;
      if (!ALLOWED_STDIO_COMMANDS.has(command)) {
        throw new Error(
          `MCP stdio command "${parsed.command}" is not in the allowlist. Allowed: ${[...ALLOWED_STDIO_COMMANDS].join(", ")}`,
        );
      }
      return new StdioClientTransport({
        command: parsed.command,
        args: parsed.args,
        env: sanitizeEnv(parsed.env),
      });
    }

    case "sse": {
      const parsed = sseConfigSchema.parse(config);
      const authToken = parsed.auth_env_var
        ? process.env[parsed.auth_env_var]
        : undefined;
      if (authToken) {
        return new SSEClientTransport(new URL(parsed.url), {
          requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
          eventSourceInit: {
            fetch: (url, init) =>
              fetch(url, {
                ...init,
                headers: {
                  ...((init?.headers as Record<string, string>) ?? {}),
                  Authorization: `Bearer ${authToken}`,
                },
              }),
          },
        });
      }
      return new SSEClientTransport(new URL(parsed.url));
    }

    case "streamable-http": {
      const parsed = streamableHttpConfigSchema.parse(config);
      return new StreamableHTTPClientTransport(new URL(parsed.url));
    }

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

  await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, connection.name);
  activeClients.set(connection.id, client);

  const { tools: mcpTools } = await withTimeout(
    client.listTools(),
    MCP_TIMEOUT_MS,
    connection.name,
  );

  const MAX_DESC_LENGTH = 500;

  return mcpTools.map((tool) => {
    const schemaInfo = tool.inputSchema
      ? `\n\nInput schema: ${JSON.stringify(tool.inputSchema)}`
      : "";
    const baseDesc = (tool.description ?? `MCP tool from ${connection.name}`).slice(
      0,
      MAX_DESC_LENGTH,
    );

    return new DynamicStructuredTool({
      name: `mcp_${sanitizeName(connection.name)}_${sanitizeName(tool.name)}`,
      description: baseDesc + schemaInfo,
      schema: tool.inputSchema
        ? jsonSchemaToZod(tool.inputSchema as Record<string, unknown>)
        : z.record(z.unknown()),
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
