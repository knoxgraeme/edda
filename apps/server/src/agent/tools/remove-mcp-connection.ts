/**
 * Tool: remove_mcp_connection — Delete an MCP server connection.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { deleteMcpConnection } from "@edda/db";
import { invalidateMCPToolCache } from "../mcp.js";

export const removeMcpConnectionSchema = z.object({
  id: z.string().describe("MCP connection ID to remove"),
});

export const removeMcpConnectionTool = tool(
  async ({ id }) => {
    await deleteMcpConnection(id);
    invalidateMCPToolCache();
    return JSON.stringify({ status: "removed", id });
  },
  {
    name: "remove_mcp_connection",
    description: "Remove an MCP server connection.",
    schema: removeMcpConnectionSchema,
  },
);
