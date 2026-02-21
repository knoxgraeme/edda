/**
 * Tool: link_item_entity — Link an item to an entity with a relationship type.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { linkItemEntity } from "@edda/db";

export const linkItemEntitySchema = z.object({
  item_id: z.string().describe("The item ID to link"),
  entity_id: z.string().describe("The entity ID to link"),
  relationship: z
    .enum(["mentioned", "about", "assigned_to", "decided_by"])
    .optional()
    .describe("Relationship type, defaults to 'mentioned'"),
});

export const linkItemEntityTool = tool(
  async ({ item_id, entity_id, relationship }) => {
    await linkItemEntity(item_id, entity_id, relationship || "mentioned");
    return JSON.stringify({ status: "linked" });
  },
  {
    name: "link_item_entity",
    description: "Link an item to an entity with a relationship type.",
    schema: linkItemEntitySchema,
  },
);
