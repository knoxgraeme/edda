/**
 * Tool: search_items — Semantic search across all items.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchItems } from "@edda/db";
import { embed } from "../../embed/index.js";

export const searchItemsSchema = z.object({
  query: z.string().describe("Natural language search query"),
  type: z.string().optional().describe("Filter by item type"),
  after: z.string().optional().describe("Only include items with day >= this date (YYYY-MM-DD)"),
  limit: z.number().optional().describe("Max results to return (default 10)"),
  agent_knowledge_only: z
    .boolean()
    .optional()
    .describe("Only search agent knowledge types (preference, learned_fact, pattern)"),
});

export const searchItemsTool = tool(
  async ({ query, type, after, limit, agent_knowledge_only }) => {
    const queryEmbedding = await embed(query);
    const results = await searchItems(queryEmbedding, {
      limit: limit ?? 10,
      type,
      after,
      agentKnowledgeOnly: agent_knowledge_only,
    });

    return JSON.stringify({
      count: results.length,
      results: results.map((r) => ({
        id: r.id,
        type: r.type,
        content: r.content,
        summary: r.summary,
        day: r.day,
        status: r.status,
        similarity: r.similarity,
        metadata: r.metadata,
      })),
    });
  },
  {
    name: "search_items",
    description:
      "Semantic search across items. Returns ranked results by similarity. Use for recall, finding related items, or answering questions from stored knowledge.",
    schema: searchItemsSchema,
  },
);
