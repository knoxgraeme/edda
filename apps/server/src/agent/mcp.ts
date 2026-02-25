/**
 * MCP tool loader — wraps @langchain/mcp-adapters for LangChain tool discovery.
 *
 * Uses a singleton MultiServerMCPClient that caches connections and tools.
 * Call invalidateMCPClient() when connections change (add/update/remove).
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Connection } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { getMcpConnections, updateMcpConnection } from "@edda/db";
import type { McpConnection } from "@edda/db";

let _client: MultiServerMCPClient | null = null;

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

function validateStdioCommand(command: string): void {
  const base = command.split("/").pop() ?? command;
  if (!ALLOWED_STDIO_COMMANDS.has(base)) {
    throw new Error(
      `MCP stdio command "${command}" not in allowlist. Allowed: ${[...ALLOWED_STDIO_COMMANDS].join(", ")}`,
    );
  }
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

function validateMcpUrl(raw: string): void {
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
}

// --- Connection config → MultiServerMCPClient format ---

function toMCPServerConfig(conn: McpConnection): Connection {
  const config = conn.config as Record<string, unknown>;

  switch (conn.transport) {
    case "stdio": {
      const command = config.command as string;
      validateStdioCommand(command);
      return {
        transport: "stdio" as const,
        command,
        args: (config.args as string[]) ?? [],
        env: sanitizeEnv(config.env as Record<string, string> | undefined),
      };
    }
    case "sse": {
      const url = config.url as string;
      validateMcpUrl(url);
      const authToken = config.auth_env_var
        ? process.env[config.auth_env_var as string]
        : undefined;
      return {
        transport: "sse" as const,
        url,
        ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
      };
    }
    case "streamable-http": {
      const url = config.url as string;
      validateMcpUrl(url);
      return {
        transport: "http" as const,
        url,
      };
    }
    default:
      throw new Error(`Unsupported MCP transport: ${conn.transport}`);
  }
}

// --- Public API ---

/**
 * Load tools from all enabled MCP connections.
 * Returns cached tools on subsequent calls. Call invalidateMCPClient()
 * when connections change.
 */
export async function loadMCPTools(): Promise<DynamicStructuredTool[]> {
  if (_client) return _client.getTools();

  const connections = await getMcpConnections();
  if (connections.length === 0) return [];

  _client = new MultiServerMCPClient({
    prefixToolNameWithServerName: true,
    additionalToolNamePrefix: "mcp",
    onConnectionError: "ignore",
    mcpServers: Object.fromEntries(
      connections.map((c) => [c.name, toMCPServerConfig(c)]),
    ),
  });

  const tools = await _client.getTools();

  // Write discovered tool names to DB (for UI display + agent tool scoping)
  for (const conn of connections) {
    const prefix = `mcp__${conn.name}__`;
    const connTools = tools.filter((t) => t.name.startsWith(prefix)).map((t) => t.name);
    if (connTools.length > 0) {
      updateMcpConnection(conn.id, { discovered_tools: connTools }).catch((err) =>
        console.warn(`[MCP] Failed to cache tools for "${conn.name}": ${err}`),
      );
    }
  }

  if (tools.length > 0) {
    console.log(`[MCP] Loaded ${tools.length} tools from ${connections.length} connections`);
  }

  return tools;
}

/**
 * Invalidate the cached MCP client. Call when connections are
 * added, updated, or removed. Next loadMCPTools() call will
 * reconnect to all servers.
 */
export async function invalidateMCPClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}

/**
 * Close all MCP connections. Call during server shutdown.
 */
export async function closeMCPClients(): Promise<void> {
  await invalidateMCPClient();
}
