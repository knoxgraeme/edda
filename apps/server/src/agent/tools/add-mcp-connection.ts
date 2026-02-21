/**
 * Tool: add_mcp_connection — Register a new MCP server connection.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createMcpConnection } from "@edda/db";

export const addMcpConnectionSchema = z.object({
  name: z.string().describe("User-facing label"),
  url: z.string().url().describe("MCP SSE endpoint URL"),
  description: z.string().optional().describe("Description of what this MCP server provides"),
  auth_header: z.string().optional().describe("Authorization header value if required"),
});

export const addMcpConnectionTool = tool(
  async ({ name, url, description, auth_header }) => {
    const config: Record<string, unknown> = { url };
    if (description) config.description = description;
    if (auth_header) config.auth_header = auth_header;

    const connection = await createMcpConnection({
      name,
      transport: "sse",
      config,
    });

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
