/**
 * Tool: add_mcp_connection — Register a new MCP server connection.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createMcpConnection } from "@edda/db";
import { invalidateMCPClient } from "../mcp.js";

export const addMcpConnectionSchema = z.object({
  name: z.string().describe("User-facing label"),
  url: z.string().url().describe("MCP SSE endpoint URL"),
  description: z.string().optional().describe("Description of what this MCP server provides"),
  auth_env_var: z
    .string()
    .regex(/^MCP_AUTH_[A-Z0-9_]+$/, "auth_env_var must match MCP_AUTH_* pattern (e.g. MCP_AUTH_MYSERVICE_TOKEN)")
    .optional()
    .describe(
      "Name of the env var holding the Bearer token (must start with MCP_AUTH_, e.g. MCP_AUTH_MYSERVICE_TOKEN). Set the actual secret in Railway secrets or .env — never pass the token value directly.",
    ),
});

export const addMcpConnectionTool = tool(
  async ({ name, url, description, auth_env_var }) => {
    const config: Record<string, unknown> = { url };
    if (description) config.description = description;
    if (auth_env_var) config.auth_env_var = auth_env_var;

    const connection = await createMcpConnection({
      name,
      transport: "sse",
      config,
    });

    await invalidateMCPClient();

    return JSON.stringify({
      id: connection.id,
      name: connection.name,
      status: "created",
    });
  },
  {
    name: "add_mcp_connection",
    description: "Register a new MCP server connection via SSE transport.",
    schema: addMcpConnectionSchema,
  },
);
