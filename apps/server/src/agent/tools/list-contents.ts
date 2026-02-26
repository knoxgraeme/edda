/**
 * Tool: get_list_contents — List all lists, or retrieve items for a specific list.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAllLists, getListItems, getListByName, getListById } from "@edda/db";

export const getListContentsSchema = z.object({
  list_id: z
    .string()
    .uuid()
    .optional()
    .describe("UUID of the list to retrieve contents for"),
  list_name: z
    .string()
    .optional()
    .describe("List name (case-insensitive) to retrieve contents for"),
});

export const getListContentsTool = tool(
  async ({ list_id, list_name }) => {
    // No-args mode: return all lists with item counts
    if (!list_id && !list_name) {
      const lists = await getAllLists();
      return JSON.stringify({
        count: lists.length,
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          summary: l.summary,
          icon: l.icon,
          list_type: l.list_type,
          item_count: l.item_count,
        })),
      });
    }

    // Resolve list by ID or name
    let list = list_id ? await getListById(list_id) : null;
    if (!list && list_name) {
      list = await getListByName(list_name);
    }
    if (!list) {
      return JSON.stringify({
        error: `List not found${list_name ? ` with name "${list_name}"` : ""}${list_id ? ` with id "${list_id}"` : ""}`,
      });
    }

    const items = await getListItems(list.id);
    return JSON.stringify({
      list: {
        id: list.id,
        name: list.name,
        summary: list.summary,
        icon: list.icon,
        list_type: list.list_type,
        status: list.status,
      },
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
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
      "With no arguments, returns all active lists with item counts. With list_id or list_name, returns the list metadata and its items.",
    schema: getListContentsSchema,
  },
);
