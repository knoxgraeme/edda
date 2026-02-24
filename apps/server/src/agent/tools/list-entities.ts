/**
 * Tool: list_entities — browse confirmed entities with optional type/search filters.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { listEntities } from "@edda/db";

export const listEntitiesSchema = z.object({
  type: z
    .enum(["person", "project", "company", "topic", "place", "tool", "concept"])
    .optional()
    .describe("Filter by entity type"),
  search: z.string().optional().describe("Name substring to search for"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of entities to return"),
});

export const listEntitiesTool = tool(
  async ({ type, search, limit }) => {
    const entities = await listEntities({ type, search, limit });

    return JSON.stringify({
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
      "List confirmed entities with optional type filter and name search. Returns entities ordered by mention count.",
    schema: listEntitiesSchema,
  },
);
