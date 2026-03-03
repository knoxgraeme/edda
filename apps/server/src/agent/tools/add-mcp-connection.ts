/**
 * Tool: add_mcp_connection — Register a new MCP server connection.
 *
 * Supports stdio, SSE, and streamable-http transports. For streamable-http
 * URLs that return 401, automatically initiates OAuth via the MCP SDK.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { createMcpConnection, updateMcpConnection } from "@edda/db";
import { invalidateMCPClient, ssrfSafeFetch } from "../../mcp/client.js";
import { invalidateAllAgents } from "../agent-cache.js";
import { MCPOAuthProvider } from "../../mcp/oauth-provider.js";
import { getLogger } from "../../logger.js";

/** Parse stringified JSON if needed. */
function maybeParseJson(val: unknown): unknown {
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

export const addMcpConnectionSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const obj = val as Record<string, unknown>;
    // LLMs sometimes nest url/description inside a "config" object — hoist them
    const config = maybeParseJson(obj.config);
    if (typeof config === "object" && config !== null) {
      const c = config as Record<string, unknown>;
      const result = { ...obj };
      if (!result.url && c.url) result.url = c.url;
      if (!result.description && c.description) result.description = c.description;
      if (!result.auth_env_var && c.auth_env_var) result.auth_env_var = c.auth_env_var;
      if (!result.command && c.command) result.command = c.command;
      if (!result.args && c.args) result.args = c.args;
      if (!result.env && c.env) result.env = c.env;
      delete result.config;
      return result;
    }
    // Parse stringified env/args
    if (obj.env) obj.env = maybeParseJson(obj.env);
    if (obj.args) obj.args = maybeParseJson(obj.args);
    return obj;
  },
  z.object({
    name: z.string().describe("User-facing label"),
    transport: z
      .enum(["stdio", "sse", "streamable-http"])
      .default("streamable-http")
      .describe("Transport type: stdio (local command), sse, or streamable-http (default)"),
    // --- stdio fields ---
    command: z
      .string()
      .optional()
      .describe("For stdio transport: the command to run (e.g. 'uvx', 'npx', 'node')"),
    args: z
      .array(z.string())
      .optional()
      .describe("For stdio transport: command arguments"),
    env: z
      .record(z.string())
      .optional()
      .describe("For stdio transport: environment variables to pass to the process"),
    // --- network fields ---
    url: z.string().url().optional().describe("MCP server endpoint URL (required for sse/streamable-http)"),
    description: z.string().optional().describe("Description of what this MCP server provides"),
    auth_env_var: z
      .string()
      .regex(
        /^MCP_AUTH_[A-Z0-9_]+$/,
        "auth_env_var must match MCP_AUTH_* pattern (e.g. MCP_AUTH_MYSERVICE_TOKEN)",
      )
      .optional()
      .describe("Env var name for Bearer token (e.g. MCP_AUTH_MYSERVICE_TOKEN)"),
  }),
);

export const addMcpConnectionTool = tool(
  async ({ name, url, description, auth_env_var, transport, command, args, env }) => {
    // Build config based on transport
    const config: Record<string, unknown> = {};

    if (transport === "stdio") {
      if (!command) {
        return JSON.stringify({
          error: "stdio transport requires 'command' (e.g. 'uvx', 'npx', 'node')",
        });
      }
      config.command = command;
      if (args) config.args = args;
      if (env) config.env = env;
    } else {
      if (!url) {
        return JSON.stringify({
          error: `${transport} transport requires 'url'`,
        });
      }
      config.url = url;
      if (auth_env_var) config.auth_env_var = auth_env_var;
    }
    if (description) config.description = description;

    const connection = await createMcpConnection({
      name,
      transport,
      config,
    });

    // For streamable-http/sse without a static bearer token, probe for OAuth
    if ((transport === "streamable-http" || transport === "sse") && !auth_env_var && url) {
      let probeStatus: number | null = null;
      try {
        const probeRes = await ssrfSafeFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "initialize",
            id: 1,
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "edda", version: "1.0.0" },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        probeStatus = probeRes.status;
      } catch {
        // Probe failed (network error, timeout) — server may not need auth
      }

      if (probeStatus === 401) {
        try {
          const baseUrl = process.env.EDDA_BASE_URL ?? "http://localhost:3000";
          const provider = new MCPOAuthProvider(connection.id, baseUrl);
          const result = await auth(provider, { serverUrl: new URL(url), fetchFn: ssrfSafeFetch });

          if (result === "REDIRECT") {
            const authUrl = provider.capturedAuthUrl;
            if (!authUrl) {
              await updateMcpConnection(connection.id, {
                auth_type: "oauth",
                auth_status: "error",
              } as Partial<typeof connection>);
              return JSON.stringify({
                id: connection.id,
                name: connection.name,
                status: "error",
                message: "OAuth flow initiated but no authorization URL was captured.",
              });
            }

            await updateMcpConnection(connection.id, {
              auth_type: "oauth",
              auth_status: "pending_auth",
            } as Partial<typeof connection>);

            return JSON.stringify({
              id: connection.id,
              name: connection.name,
              status: "pending_auth",
              auth_url: authUrl.toString(),
              message:
                "OAuth authentication required. Click the link to authorize, then your connection will be ready.",
            });
          }
          // AUTHORIZED on first call (unlikely but possible with cached tokens)
          if (result === "AUTHORIZED") {
            await updateMcpConnection(connection.id, {
              auth_type: "oauth",
              auth_status: "active",
            } as Partial<typeof connection>);
          }
        } catch (err) {
          getLogger().warn({ connection: name, err }, "OAuth auth failed for MCP connection");
          await updateMcpConnection(connection.id, {
            auth_type: "oauth",
            auth_status: "error",
          } as Partial<typeof connection>);
          return JSON.stringify({
            id: connection.id,
            name: connection.name,
            status: "error",
            message: `OAuth authentication failed: ${err instanceof Error ? err.message : "unknown error"}`,
          });
        }
      }
    }

    await invalidateMCPClient();
    invalidateAllAgents();

    return JSON.stringify({
      id: connection.id,
      name: connection.name,
      status: "created",
    });
  },
  {
    name: "add_mcp_connection",
    description:
      "Register a new MCP server connection. Supports stdio (local command like uvx/npx), SSE, and streamable-http transports. For servers requiring OAuth, returns an auth URL the user must visit.",
    schema: addMcpConnectionSchema,
  },
);
