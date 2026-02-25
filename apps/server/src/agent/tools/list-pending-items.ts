/**
 * Tool: list_pending_items — List items awaiting user confirmation.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getPendingItems } from "@edda/db";

export const listPendingItemsSchema = z.object({
  table: z
    .enum(["items", "entities", "item_types", "all"])
    .optional()
    .default("all")
    .describe("Filter to a specific table, or 'all' for everything pending"),
});

export const listPendingItemsTool = tool(
  async ({ table }) => {
    const pending = await getPendingItems();
    const filtered = table === "all" ? pending : pending.filter((p) => p.table === table);
    return JSON.stringify({
      count: filtered.length,
      pending: filtered,
    });
  },
  {
    name: "list_pending_items",
    description:
      "List all items, entities, and item types that are pending user confirmation. Use when the user asks about approvals or pending items.",
    schema: listPendingItemsSchema,
  },
);
