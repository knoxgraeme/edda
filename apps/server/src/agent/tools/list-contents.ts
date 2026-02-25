/**
 * Tool: get_list_contents — Retrieve items belonging to a list by its ID.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getListItems } from "@edda/db";

export const getListContentsSchema = z.object({
  list_id: z
    .string()
    .uuid()
    .describe("UUID of the list item (type='list') to retrieve contents for"),
});

export const getListContentsTool = tool(
  async ({ list_id }) => {
    const items = await getListItems(list_id);
    return JSON.stringify({
      list_id,
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
    name: "get_list_contents",
    description:
      "Retrieve all active items in a list by its ID. First search for lists with search_items(type='list'), then use the list's ID here.",
    schema: getListContentsSchema,
  },
);
