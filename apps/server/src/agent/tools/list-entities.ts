/**
 * Tool: list_entities — browse or semantically search confirmed entities.
 *
 * Two modes:
 * - Browse: filter by type/search (ILIKE), ordered by mention count
 * - Semantic: embed a natural language query and search entity vectors
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { listEntities, searchEntities } from "@edda/db";
import { embed } from "../../embed.js";

export const listEntitiesSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Natural language query for semantic entity search (e.g. 'the AI company Elon runs')"),
  type: z
    .enum(["person", "project", "company", "topic", "place", "tool", "concept"])
    .optional()
    .describe("Filter by entity type"),
  search: z.string().optional().describe("Name substring to search for (ILIKE)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of entities to return"),
});

export const listEntitiesTool = tool(
  async ({ query, type, search, limit }) => {
    // Semantic mode: embed query and search entity vectors
    if (query) {
      const queryEmbedding = await embed(query);
      const results = await searchEntities(queryEmbedding, { type, limit });

      return JSON.stringify({
        mode: "semantic",
        entities: results.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          description: e.description,
          aliases: e.aliases,
          mention_count: e.mention_count,
          last_seen_at: e.last_seen_at,
          similarity: e.similarity,
        })),
        total: results.length,
      });
    }

    // Browse mode: text-based filtering
    const entities = await listEntities({ type, search, limit });

    return JSON.stringify({
      mode: "browse",
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        description: e.description,
        aliases: e.aliases,
        mention_count: e.mention_count,
        last_seen_at: e.last_seen_at,
      })),
      total: entities.length,
    });
  },
  {
    name: "list_entities",
    description:
      "List or search entities. With 'query', performs semantic search over entity embeddings. " +
      "Without 'query', browses entities with optional type filter and name search (ILIKE). " +
      "Returns entities ordered by relevance (semantic) or mention count (browse).",
    schema: listEntitiesSchema,
  },
);
