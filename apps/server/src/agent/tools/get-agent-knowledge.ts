/**
 * Tool: get_agent_knowledge — Retrieve learned preferences, facts, and patterns.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentKnowledge } from "@edda/db";

export const getAgentKnowledgeSchema = z.object({
  order_by: z
    .enum(["recent", "reinforced", "updated"])
    .optional()
    .describe("Sort order: 'recent' (created), 'reinforced' (last reinforced), 'updated' (last modified). Default: reinforced"),
  limit: z.number().optional().describe("Max items to return (default 100)"),
});

export const getAgentKnowledgeTool = tool(
  async ({ order_by, limit }) => {
    const items = await getAgentKnowledge({
      orderBy: order_by,
      limit,
    });
    return JSON.stringify({
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        content: item.content,
        summary: item.summary,
        day: item.day,
        metadata: item.metadata,
        last_reinforced_at: item.last_reinforced_at,
      })),
    });
  },
  {
    name: "get_agent_knowledge",
    description:
      "Retrieve all learned knowledge (preferences, learned facts, patterns). Use to review what has been learned about the user.",
    schema: getAgentKnowledgeSchema,
  },
);
