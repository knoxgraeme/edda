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
  auth_env_var: z.string().optional(),
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
    throw new Error(`MCP URL scheme "${url.protocol}" is not allowed. Only http: and https: are permitted.`);
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
