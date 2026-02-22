/**
 * Tool: delete_item — Permanently delete an item.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { deleteItem } from "@edda/db";

export const deleteItemSchema = z.object({
  item_id: z.string().uuid().describe("The ID of the item to delete"),
});

export const deleteItemTool = tool(
  async ({ item_id }) => {
    const deleted = await deleteItem(item_id);
    if (!deleted) {
      return JSON.stringify({ status: "not_found", item_id });
    }
    return JSON.stringify({ status: "deleted", item_id });
  },
  {
    name: "delete_item",
    description: "Permanently delete an item from the knowledge base. This cannot be undone.",
    schema: deleteItemSchema,
  },
);
