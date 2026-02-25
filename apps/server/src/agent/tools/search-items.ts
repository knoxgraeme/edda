/**
 * Tool: search_items — Semantic search across all items.
 *
 * When called without a query and agent_knowledge_only=true, falls back to
 * an ordered listing of agent knowledge (replaces the old get_agent_knowledge tool).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchItems, getAgentKnowledge } from "@edda/db";
import type { RetrievalContext } from "@edda/db";
import { embed, buildEmbeddingText } from "../../embed/index.js";

export const searchItemsSchema = z.object({
  query: z.string().optional().describe("Natural language search query (required unless using agent_knowledge_only listing mode)"),
  type: z.string().optional().describe("Filter by item type"),
  after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
    .optional()
    .describe("Only include items with day >= this date (YYYY-MM-DD)"),
  limit: z.number().int().min(1).max(100).default(20).describe("Max results to return"),
  agent_knowledge_only: z
    .boolean()
    .optional()
    .describe("Only search agent knowledge types (preference, learned_fact, pattern)"),
  metadata: z
    .record(z.string())
    .optional()
    .describe("Filter by exact metadata field values, e.g. {category: 'movies'}"),
  order_by: z
    .enum(["recent", "reinforced", "updated"])
    .optional()
    .describe("Sort order for listing mode (no query + agent_knowledge_only): 'recent' (created), 'reinforced' (last reinforced), 'updated' (last modified)"),
});

export const searchItemsTool = tool(
  async ({ query, type, after, limit, agent_knowledge_only, metadata, order_by }, config) => {
    // Listing mode: no query + agent_knowledge_only = ordered listing
    if (!query && agent_knowledge_only) {
      const items = await getAgentKnowledge({ orderBy: order_by, limit });
      return JSON.stringify({
        count: items.length,
        results: items.map((item) => ({
          id: item.id,
          type: item.type,
          content: item.content,
          summary: item.summary,
          day: item.day,
          status: item.status,
          metadata: item.metadata,
          last_reinforced_at: item.last_reinforced_at,
        })),
      });
    }

    if (!query) {
      return JSON.stringify({
        error: "query is required unless agent_knowledge_only=true (listing mode)",
        count: 0,
        results: [],
      });
    }

    // Retrieval context is resolved once at agent construction time and injected
    // via config.configurable by the cron runner (see standalone.ts).
    const retrievalContext = config?.configurable?.retrieval_context as
      | RetrievalContext
      | undefined;

    // Embed query in the same format used for stored items when type is known,
    // so cosine similarity scores aren't degraded by format mismatch.
    const embeddingText = type ? buildEmbeddingText(type, query) : query;
    const queryEmbedding = await embed(embeddingText);
    const results = await searchItems(queryEmbedding, {
      limit,
      type,
      after,
      agentKnowledgeOnly: agent_knowledge_only,
      metadata,
      retrieval_context: retrievalContext,
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
        raw_similarity: r.raw_similarity,
        metadata: r.metadata,
      })),
    });
  },
  {
    name: "search_items",
    description:
      "Semantic search across items. Returns ranked results by similarity. Use for recall, finding related items, or answering questions from stored knowledge. When called with agent_knowledge_only=true and no query, lists all agent knowledge ordered by order_by.",
    schema: searchItemsSchema,
  },
);
