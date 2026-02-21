/**
 * Tool: list_mcp_connections — List all enabled MCP server connections.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getMcpConnections } from "@edda/db";

export const listMcpConnectionsSchema = z.object({});

export const listMcpConnectionsTool = tool(
  async () => {
    const connections = await getMcpConnections();
    return JSON.stringify(connections);
  },
  {
    name: "list_mcp_connections",
    description: "List all enabled MCP server connections.",
    schema: listMcpConnectionsSchema,
  },
);
