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
import { withTimeout } from "../utils/with-timeout.js";
import { MCPOAuthProvider } from "./mcp-oauth-provider.js";

let _client: MultiServerMCPClient | null = null;
let _initPromise: Promise<DynamicStructuredTool[]> | null = null;

const MCP_INIT_TIMEOUT_MS = parseInt(process.env.MCP_TIMEOUT_MS ?? "30000", 10);

// --- Name sanitization ---

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

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
//
// NOTE on DNS rebinding: A domain could resolve to a public IP during validation
// but to a private IP when the actual connection is made. Full mitigation requires
// async DNS resolution pinning (resolve, validate, connect to the resolved IP),
// which is complex for a synchronous URL validation function. The practical
// mitigation is that MCP connections require authenticated access to create.

const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^192\.168\./, // 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^169\.254\./, // link-local / cloud metadata
  /^0\./, // 0.0.0.0/8
];

/**
 * Check whether an IPv6 address (without brackets) is private/reserved.
 * Covers ULA (fc00::/7), link-local (fe80::/10), loopback (::1),
 * and IPv4-mapped addresses (::ffff:x.x.x.x).
 */
function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();

  // Loopback
  if (lower === "::1") return true;

  // ULA — fc00::/7 covers fc00:: through fdff::
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  // Link-local — fe80::/10
  if (lower.startsWith("fe80")) return true;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract the IPv4 part and check it
  const v4MappedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch) {
    const ipv4 = v4MappedMatch[1];
    if (isPrivateIPv4(ipv4)) return true;
  }

  return false;
}

/**
 * Check whether an IPv4 string matches known private/reserved ranges.
 */
function isPrivateIPv4(ip: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(ip)) return true;
  }
  return false;
}

/**
 * Detect and normalize decimal/octal encoded IPv4 addresses.
 * Returns the normalized dotted-decimal IP, or null if not an encoded IP.
 *
 * Handles:
 *   - Pure decimal: "2130706433" -> "127.0.0.1"
 *   - Octal octets: "0177.0.0.1" -> "127.0.0.1"
 */
function normalizeEncodedIP(hostname: string): string | null {
  // Pure decimal IP (single integer) e.g. 2130706433 = 127.0.0.1
  if (/^\d+$/.test(hostname) && !hostname.includes(".")) {
    const num = Number(hostname);
    if (num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff,
      ].join(".");
    }
  }

  // Dotted notation — check for octal octets (leading zero)
  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const hasOctal = parts.some((p) => p.length > 1 && p.startsWith("0"));
    if (hasOctal) {
      // Parse each octet: leading 0 means octal in many network stacks
      const octets = parts.map((p) => (p.startsWith("0") ? parseInt(p, 8) : parseInt(p, 10)));
      if (octets.every((o) => o >= 0 && o <= 255)) {
        return octets.join(".");
      }
    }
  }

  return null;
}

export function validateMcpUrl(raw: string): string {
  const url = new URL(raw);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `MCP URL scheme "${url.protocol}" is not allowed. Only http: and https: are permitted.`,
    );
  }

  const hostname = url.hostname;

  if (hostname === "localhost") {
    throw new Error(`MCP URL hostname "${hostname}" resolves to a private/reserved address.`);
  }

  // Strip brackets from IPv6 addresses (URL parser may include them)
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  // IPv6 private range check
  if (bare.includes(":")) {
    if (isPrivateIPv6(bare)) {
      throw new Error(`MCP URL hostname "${hostname}" resolves to a private/reserved address.`);
    }
    // If it's an IPv6 address that passed, allow it
    return url.toString();
  }

  // Decimal/octal encoded IP detection
  const normalized = normalizeEncodedIP(bare);
  if (normalized) {
    if (isPrivateIPv4(normalized)) {
      throw new Error(
        `MCP URL hostname "${hostname}" resolves to a private/reserved address (decoded: ${normalized}).`,
      );
    }
    // Even if the decoded IP is public, block encoded forms as they suggest evasion
    throw new Error(
      `MCP URL hostname "${hostname}" uses an encoded IP representation which is not allowed.`,
    );
  }

  // Standard IPv4 private range check
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(bare)) {
      throw new Error(`MCP URL hostname "${hostname}" resolves to a private/reserved address.`);
    }
  }

  return url.toString();
}

/**
 * Fetch wrapper that validates URLs through validateMcpUrl before making requests.
 * Pass this to the MCP SDK's auth() as fetchFn to prevent SSRF during OAuth discovery.
 */
export function ssrfSafeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  validateMcpUrl(typeof url === "string" ? url : url.toString());
  return fetch(url, init);
}

// --- Connection config → MultiServerMCPClient format ---

function toMCPServerConfig(conn: McpConnection): Connection {
  const config = conn.config as Record<string, unknown>;

  switch (conn.transport) {
    case "stdio": {
      if (typeof config.command !== "string") {
        throw new Error(`MCP stdio config missing "command" for "${conn.name}"`);
      }
      const command = config.command;
      validateStdioCommand(command);
      return {
        transport: "stdio" as const,
        command,
        args: (config.args as string[]) ?? [],
        env: sanitizeEnv(config.env as Record<string, string> | undefined),
      };
    }
    case "sse": {
      if (typeof config.url !== "string") {
        throw new Error(`MCP SSE config missing "url" for "${conn.name}"`);
      }
      const url = validateMcpUrl(config.url);
      if (config.auth_env_var && !/^MCP_AUTH_[A-Z0-9_]+$/.test(config.auth_env_var as string)) {
        throw new Error(
          `MCP auth_env_var "${config.auth_env_var}" must match MCP_AUTH_* pattern (e.g. MCP_AUTH_MYSERVICE_TOKEN).`,
        );
      }
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
      if (typeof config.url !== "string") {
        throw new Error(`MCP streamable-http config missing "url" for "${conn.name}"`);
      }
      const url = validateMcpUrl(config.url);
      const httpConfig: Connection = {
        transport: "http" as const,
        url,
      };
      if (conn.auth_type === "oauth") {
        const baseUrl = process.env.EDDA_BASE_URL ?? "http://localhost:3000";
        httpConfig.authProvider = new MCPOAuthProvider(conn.id, baseUrl);
      }
      return httpConfig;
    }
    default:
      throw new Error(`Unsupported MCP transport: ${conn.transport}`);
  }
}

// --- Internal init helper ---

async function _initMCPClient(): Promise<DynamicStructuredTool[]> {
  const allConnections = await getMcpConnections();
  const connections = allConnections.filter((c) => c.auth_status !== "pending_auth");
  if (connections.length === 0) return [];

  const client = new MultiServerMCPClient({
    prefixToolNameWithServerName: true,
    additionalToolNamePrefix: "mcp",
    onConnectionError: (err: { serverName: string; error?: unknown }) => {
      console.warn(`[MCP] Connection failed for "${err.serverName}": ${err.error}`);
    },
    mcpServers: Object.fromEntries(
      connections.map((c) => [sanitizeName(c.name), toMCPServerConfig(c)]),
    ),
  });

  const tools = await withTimeout(client.getTools(), MCP_INIT_TIMEOUT_MS, "MCP tool discovery");

  // Only cache the client after getTools() succeeds
  _client = client;

  // Write discovered tool names to DB (for UI display + agent tool scoping)
  for (const conn of connections) {
    const prefix = `mcp__${sanitizeName(conn.name)}__`;
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

// --- Public API ---

/**
 * Load tools from all enabled MCP connections.
 * Returns cached tools on subsequent calls. Call invalidateMCPClient()
 * when connections change.
 */
export async function loadMCPTools(): Promise<DynamicStructuredTool[]> {
  if (_client) return _client.getTools();
  if (_initPromise) return _initPromise;
  _initPromise = _initMCPClient();
  try {
    return await _initPromise;
  } catch (err) {
    _initPromise = null; // allow retry on failure
    throw err;
  }
}

/**
 * Invalidate the cached MCP client. Call when connections are
 * added, updated, or removed. Next loadMCPTools() call will
 * reconnect to all servers.
 */
export async function invalidateMCPClient(): Promise<void> {
  _initPromise = null;
  if (_client) {
    const client = _client;
    _client = null;
    await client.close();
  }
}

/**
 * Close all MCP connections. Call during server shutdown.
 */
export async function closeMCPClients(): Promise<void> {
  await invalidateMCPClient();
}
