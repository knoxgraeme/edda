/**
 * Tool: batch_create_items — Create multiple items in a single transaction.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { batchCreateItems, getSettingsSync } from "@edda/db";
import { embed } from "../../embed/index.js";

const batchItemSchema = z.object({
  content: z.string().describe("The item content text"),
  summary: z.string().optional().describe("Short summary of the item"),
  type: z.string().describe("Item type (must exist in item_types)"),
  day: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
  metadata: z.record(z.any()).optional().describe("Arbitrary metadata for the item"),
  parent_id: z.string().optional().describe("Parent item ID"),
  confirmed: z.boolean().optional().describe("Default true. Set false when approval is needed."),
});

export const batchCreateItemsSchema = z.object({
  items: z.array(batchItemSchema).min(1).describe("Array of items to create"),
});

export const batchCreateItemsTool = tool(
  async ({ items }) => {
    const settings = getSettingsSync();
    const today = new Date().toISOString().split("T")[0];

    const embeddings = await Promise.all(items.map((item) => embed(item.content)));

    const inputs = items.map((item, i) => ({
      content: item.content,
      summary: item.summary,
      type: item.type,
      embedding: embeddings[i],
      embedding_model: settings.embedding_model,
      day: item.day || today,
      metadata: item.metadata || {},
      parent_id: item.parent_id,
      confirmed: item.confirmed ?? true,
      source: "chat" as const,
    }));

    const created = await batchCreateItems(inputs);

    return JSON.stringify({
      count: created.length,
      item_ids: created.map((item) => item.id),
    });
  },
  {
    name: "batch_create_items",
    description:
      "Create multiple items in a single batch. More efficient than calling create_item repeatedly.",
    schema: batchCreateItemsSchema,
  },
);
