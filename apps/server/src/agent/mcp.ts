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
import { getMcpConnections, updateMcpConnection } from "@edda/db";
import type { McpConnection } from "@edda/db";
import { withTimeout } from "../utils/with-timeout.js";

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
// NOTE: ALLOWED_STDIO_COMMANDS and BLOCKED_ENV_KEYS are duplicated in apps/web/src/lib/mcp-probe.ts.
// Keep both copies in sync. See todo #175 for shared module extraction.

const ALLOWED_STDIO_COMMANDS = new Set(["node", "npx", "python", "python3", "uvx", "deno"]);

const BLOCKED_ENV_KEYS = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "HOME",
  "SHELL",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "PERL5OPT",
  "BASH_ENV",
  "ENV",
  "LD_AUDIT",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "ELECTRON_RUN_AS_NODE",
]);

function sanitizeEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(Object.entries(env).filter(([k]) => !BLOCKED_ENV_KEYS.has(k)));
}

// --- URL security: SSRF prevention ---
// NOTE: validateMcpUrl is duplicated in apps/web/src/lib/mcp-probe.ts.
// Keep both copies in sync. See todo #175 for shared module extraction.

const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^192\.168\./, // 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^169\.254\./, // link-local / cloud metadata
  /^0\./, // 0.0.0.0/8
];

function validateMcpUrl(raw: string): URL {
  const url = new URL(raw);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `MCP URL scheme "${url.protocol}" is not allowed. Only http: and https: are permitted.`,
    );
  }

  const hostname = url.hostname;

  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    throw new Error(`MCP URL hostname "${hostname}" resolves to a private/reserved address.`);
  }

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`MCP URL hostname "${hostname}" resolves to a private/reserved address.`);
    }
  }

  return url;
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
        command: command,
        args: parsed.args,
        env: sanitizeEnv(parsed.env),
      });
    }

    case "sse": {
      const parsed = sseConfigSchema.parse(config);
      const validatedUrl = validateMcpUrl(parsed.url);
      const authToken = parsed.auth_env_var
        ? process.env[parsed.auth_env_var]
        : undefined;
      if (authToken) {
        return new SSEClientTransport(validatedUrl, {
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
      return new SSEClientTransport(validatedUrl);
    }

    case "streamable-http": {
      const parsed = streamableHttpConfigSchema.parse(config);
      const validatedUrl = validateMcpUrl(parsed.url);
      return new StreamableHTTPClientTransport(validatedUrl);
    }

    default:
      throw new Error(`Unsupported MCP transport: ${connection.transport}`);
  }
}

// --- Tool cache (avoids redundant MCP connections across concurrent buildAgent() calls) ---

let _cachedTools: DynamicStructuredTool[] | null = null;
let _cacheTimestamp = 0;
const MCP_CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Load tools from all enabled MCP connections.
 * Returns cached tools if available and fresh. Also writes back discovered
 * tool names to the DB as a cache refresh on first load.
 */
export async function loadMCPTools(): Promise<DynamicStructuredTool[]> {
  const now = Date.now();
  if (_cachedTools && now - _cacheTimestamp < MCP_CACHE_TTL_MS) {
    return _cachedTools;
  }

  const connections = await getMcpConnections();

  if (connections.length === 0) {
    _cachedTools = [];
    _cacheTimestamp = now;
    return [];
  }

  const results = await Promise.allSettled(
    connections.map((conn) => loadToolsFromConnection(conn)),
  );

  const tools: DynamicStructuredTool[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      tools.push(...result.value);

      // Write back discovered tool names as a cache refresh
      const toolNames = result.value.map((t) => t.name);
      updateMcpConnection(connections[i].id, { discovered_tools: toolNames }).catch((err) =>
        console.warn(`[MCP] Failed to cache tools for "${connections[i].name}": ${err}`),
      );
    } else {
      console.warn(
        `[MCP] Failed to load tools from "${connections[i].name}": ${result.reason}`,
      );
    }
  }

  if (tools.length > 0) {
    console.log(`[MCP] Loaded ${tools.length} tools from ${connections.length} connections`);
  }

  _cachedTools = tools;
  _cacheTimestamp = now;
  return tools;
}

/**
 * Invalidate the MCP tool cache. Call when connections are added, updated,
 * or removed so the next loadMCPTools() call rediscovers tools.
 */
export function invalidateMCPToolCache(): void {
  _cachedTools = null;
  _cacheTimestamp = 0;
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

  const existing = activeClients.get(connection.id);
  if (existing) {
    await existing.close().catch((err) =>
      console.warn(`[MCP] Failed to close old client for "${connection.name}":`, err),
    );
  }
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
        const result = await withTimeout(
          client.callTool({
            name: tool.name,
            arguments: input,
          }),
          MCP_TIMEOUT_MS * 3,
          `${connection.name}/${tool.name}`,
        );
        return JSON.stringify(result.content);
      },
    });
  });
}

/** Sanitize a name for use in tool identifiers (alphanumeric + underscores) */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}
