/**
 * Tool: list_entity_items — Retrieve all items linked to an entity by name or alias.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveEntity, getEntityItems } from "@edda/db";

export const listEntityItemsSchema = z.object({
  name: z.string().describe("Entity name or alias to look up"),
  limit: z.number().int().min(1).max(100).default(20).describe("Max items to return"),
});

export const listEntityItemsTool = tool(
  async ({ name, limit }) => {
    const entity = await resolveEntity(name);
    if (!entity) return JSON.stringify({ found: false, items: [] });
    const items = await getEntityItems(entity.id, { limit });
    return JSON.stringify({ entity, items });
  },
  {
    name: "list_entity_items",
    description: "All items linked to an entity. Resolves by name or alias.",
    schema: listEntityItemsSchema,
  },
);
