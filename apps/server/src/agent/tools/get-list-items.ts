/**
 * Tool: get_list_items — Retrieve items belonging to a named list.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getListItems } from "@edda/db";

export const getListItemsSchema = z.object({
  list_name: z.string().describe("Name of the list to retrieve"),
});

export const getListItemsTool = tool(
  async ({ list_name }) => {
    const items = await getListItems(list_name);
    return JSON.stringify({
      list_name,
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        content: item.content,
        summary: item.summary,
        status: item.status,
        metadata: item.metadata,
        created_at: item.created_at,
      })),
    });
  },
  {
    name: "get_list_items",
    description: "Retrieve all active items in a named list.",
    schema: getListItemsSchema,
  },
);
