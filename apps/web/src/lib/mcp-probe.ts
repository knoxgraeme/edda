/**
 * Lightweight MCP probe for API routes.
 * Connects to an MCP server, lists its tools, and returns sanitized tool names.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { McpConnection } from "@edda/db";

const MCP_TIMEOUT_MS = parseInt(process.env.MCP_TIMEOUT_MS ?? "10000", 10);

// --- Config validation schemas ---

const stdioConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

const sseConfigSchema = z.object({
  url: z.string(),
  auth_env_var: z
    .string()
    .regex(/^MCP_AUTH_[A-Z0-9_]+$/, "auth_env_var must match MCP_AUTH_* pattern")
    .optional(),
});

const streamableHttpConfigSchema = z.object({
  url: z.string(),
});

// --- Stdio security: command allowlist + env filtering ---
// NOTE: ALLOWED_STDIO_COMMANDS and BLOCKED_ENV_KEYS are duplicated in apps/server/src/agent/mcp.ts.
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
// NOTE: validateMcpUrl is duplicated in apps/server/src/agent/mcp.ts.
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

function validateMcpUrl(raw: string): URL {
  const url = new URL(raw);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`MCP URL scheme "${url.protocol}" is not allowed. Only http: and https: are permitted.`);
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
    return url;
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

  return url;
}

// --- Name sanitization (must match server-side @langchain/mcp-adapters naming) ---

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

// --- Helpers ---

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
  let transport;

  switch (connection.transport) {
    case "stdio": {
      const parsed = stdioConfigSchema.parse(connection.config);
      const command = parsed.command.split("/").pop() ?? parsed.command;
      if (!ALLOWED_STDIO_COMMANDS.has(command)) {
        throw new Error(
          `MCP stdio command "${parsed.command}" is not in the allowlist. Allowed: ${[...ALLOWED_STDIO_COMMANDS].join(", ")}`,
        );
      }
      transport = new StdioClientTransport({
        command: command,
        args: parsed.args,
        env: sanitizeEnv(parsed.env),
      });
      break;
    }
    case "sse": {
      const parsed = sseConfigSchema.parse(connection.config);
      const url = validateMcpUrl(parsed.url);
      transport = new SSEClientTransport(url);
      break;
    }
    case "streamable-http": {
      const parsed = streamableHttpConfigSchema.parse(connection.config);
      const url = validateMcpUrl(parsed.url);
      transport = new StreamableHTTPClientTransport(url);
      break;
    }
    default:
      return [];
  }

  const client = new Client({ name: "edda", version: "1.0.0" });

  try {
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, connection.name);
    const { tools } = await withTimeout(client.listTools(), MCP_TIMEOUT_MS, connection.name);
    return tools.map((t) => `mcp__${sanitizeName(connection.name)}__${t.name}`);
  } catch (err) {
    console.warn(`[MCP Probe] Failed to probe "${connection.name}": ${err}`);
    return [];
  } finally {
    await client.close().catch((err) => {
      console.warn(`[MCP Probe] Error closing client for "${connection.name}": ${err}`);
    });
  }
}
