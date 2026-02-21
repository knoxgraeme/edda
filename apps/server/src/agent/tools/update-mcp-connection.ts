/**
 * Tool: update_mcp_connection — Update an existing MCP server connection.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { updateMcpConnection } from "@edda/db";
import type { McpConnection } from "@edda/db";

export const updateMcpConnectionSchema = z.object({
  id: z.string().describe("MCP connection ID"),
  enabled: z.boolean().optional().describe("Enable or disable the connection"),
  name: z.string().optional().describe("New display name"),
});

export const updateMcpConnectionTool = tool(
  async ({ id, enabled, name }) => {
    const updates: Partial<Pick<McpConnection, "enabled" | "name">> = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (name !== undefined) updates.name = name;

    const connection = await updateMcpConnection(id, updates);
    if (!connection) {
      return JSON.stringify({ status: "not_found", id });
    }
    return JSON.stringify({ status: "updated", connection });
  },
  {
    name: "update_mcp_connection",
    description: "Update an existing MCP server connection (enable/disable or rename).",
    schema: updateMcpConnectionSchema,
  },
);
