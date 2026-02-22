/**
 * Tool: get_item_by_id — Retrieve a single item by its ID.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getItemById } from "@edda/db";

export const getItemByIdSchema = z.object({
  item_id: z.string().uuid().describe("The item ID to look up"),
});

export const getItemByIdTool = tool(
  async ({ item_id }) => {
    const item = await getItemById(item_id);
    if (!item) {
      return JSON.stringify({ found: false, item_id });
    }
    return JSON.stringify({
      found: true,
      item: {
        id: item.id,
        type: item.type,
        content: item.content,
        summary: item.summary,
        day: item.day,
        status: item.status,
        metadata: item.metadata,
        confirmed: item.confirmed,
        pending_action: item.pending_action,
        created_at: item.created_at,
        updated_at: item.updated_at,
      },
    });
  },
  {
    name: "get_item_by_id",
    description: "Retrieve a single item by its ID. Returns full item details.",
    schema: getItemByIdSchema,
  },
);
