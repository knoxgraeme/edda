/**
 * Tool: add_mcp_connection — Register a new MCP server connection.
 *
 * Supports SSE and streamable-http transports. For streamable-http URLs
 * that return 401, automatically initiates OAuth via the MCP SDK.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { createMcpConnection, updateMcpConnection } from "@edda/db";
import { invalidateMCPClient, ssrfSafeFetch } from "../../mcp/client.js";
import { MCPOAuthProvider } from "../../mcp/oauth-provider.js";
import { getLogger } from "../../logger.js";

export const addMcpConnectionSchema = z.object({
  name: z.string().describe("User-facing label"),
  url: z.string().url().describe("MCP server endpoint URL"),
  transport: z
    .enum(["sse", "streamable-http"])
    .default("streamable-http")
    .describe("Transport type (default: streamable-http)"),
  description: z.string().optional().describe("Description of what this MCP server provides"),
  auth_env_var: z
    .string()
    .regex(
      /^MCP_AUTH_[A-Z0-9_]+$/,
      "auth_env_var must match MCP_AUTH_* pattern (e.g. MCP_AUTH_MYSERVICE_TOKEN)",
    )
    .optional()
    .describe("Env var name for Bearer token (e.g. MCP_AUTH_MYSERVICE_TOKEN)"),
});

export const addMcpConnectionTool = tool(
  async ({ name, url, description, auth_env_var, transport }) => {
    const config: Record<string, unknown> = { url };
    if (description) config.description = description;
    if (auth_env_var) config.auth_env_var = auth_env_var;

    const connection = await createMcpConnection({
      name,
      transport,
      config,
    });

    // For streamable-http without a static bearer token, probe for OAuth
    if ((transport === "streamable-http" || transport === "sse") && !auth_env_var) {
      let probeStatus: number | null = null;
      try {
        const probeRes = await ssrfSafeFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "edda", version: "1.0.0" } } }),
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

    return JSON.stringify({
      id: connection.id,
      name: connection.name,
      status: "created",
    });
  },
  {
    name: "add_mcp_connection",
    description:
      "Register a new MCP server connection. Supports SSE and streamable-http transports. For servers requiring OAuth, returns an auth URL the user must visit.",
    schema: addMcpConnectionSchema,
  },
);
