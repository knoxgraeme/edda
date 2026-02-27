/**
 * Tool: get_list_contents — List all lists, or retrieve items for a specific list.
 *
 * Supports semantic search for finding lists by natural language query.
 * Resolution cascade: list_id → list_name (exact → fuzzy) → query (semantic).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAllLists, getListItems, getListById, resolveList, searchLists } from "@edda/db";
import { embed } from "../../embed.js";

export const getListContentsSchema = z.object({
  list_id: z
    .string()
    .uuid()
    .optional()
    .describe("UUID of the list to retrieve contents for"),
  list_name: z
    .string()
    .optional()
    .describe("List name (case-insensitive, supports fuzzy matching) to retrieve contents for"),
  query: z
    .string()
    .optional()
    .describe("Natural language query to find a list semantically (e.g. 'my movie recommendations')"),
});

export const getListContentsTool = tool(
  async ({ list_id, list_name, query }) => {
    // No-args mode: return all lists with item counts
    if (!list_id && !list_name && !query) {
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

    // Resolve list by ID, name (exact → fuzzy), or semantic search
    let list = list_id ? await getListById(list_id) : null;
    if (!list && list_name) {
      list = await resolveList(list_name);
    }
    if (!list && query) {
      const queryEmbedding = await embed(query);
      const results = await searchLists(queryEmbedding, { limit: 1 });
      if (results.length > 0) {
        list = await getListById(results[0].id);
      }
    }
    if (!list) {
      return JSON.stringify({
        error: `List not found${list_name ? ` with name "${list_name}"` : ""}${list_id ? ` with id "${list_id}"` : ""}${query ? ` matching "${query}"` : ""}. Try get_list_contents with no arguments to see all available lists.`,
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
      "With no arguments, returns all active lists with item counts. With list_id, list_name (supports fuzzy matching), " +
      "or query (semantic search), returns the list metadata and its items.",
    schema: getListContentsSchema,
  },
);
