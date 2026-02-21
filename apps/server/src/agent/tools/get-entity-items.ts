/**
 * Tool: get_entity_items — Retrieve all items linked to an entity by name or alias.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveEntity, getEntityItems } from "@edda/db";

export const getEntityItemsSchema = z.object({
  name: z.string().describe("Entity name or alias to look up"),
  limit: z.number().optional().describe("Max items to return, defaults to 20"),
});

export const getEntityItemsTool = tool(
  async ({ name, limit }) => {
    const entity = await resolveEntity(name);
    if (!entity) return JSON.stringify({ found: false, items: [] });
    const items = await getEntityItems(entity.id, { limit: limit || 20 });
    return JSON.stringify({ entity, items });
  },
  {
    name: "get_entity_items",
    description: "All items linked to an entity. Resolves by name or alias.",
    schema: getEntityItemsSchema,
  },
);
