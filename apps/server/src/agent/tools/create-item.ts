/**
 * Tool: create_item — Create a single item in the knowledge base.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createItem, getSettingsSync } from "@edda/db";
import { embed } from "../../embed/index.js";

export const createItemSchema = z.object({
  content: z.string().describe("The item content text"),
  summary: z.string().optional().describe("Short summary of the item"),
  type: z.string().describe("Item type (must exist in item_types)"),
  day: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
  metadata: z.record(z.any()).optional().describe("Arbitrary metadata for the item"),
  parent_id: z.string().optional().describe("Parent item ID for hierarchical items"),
  confirmed: z
    .boolean()
    .optional()
    .describe("Default true. Set false when approval is needed."),
});

export const createItemTool = tool(
  async ({ content, summary, type, day, metadata, parent_id, confirmed }) => {
    const settings = getSettingsSync();
    const embedding = await embed(content);
    const item = await createItem({
      content,
      summary,
      type,
      embedding,
      embedding_model: settings.embedding_model,
      day: day || new Date().toISOString().split("T")[0],
      metadata: metadata || {},
      parent_id,
      confirmed: confirmed ?? true,
      source: "chat",
    });
    return JSON.stringify({
      item_id: item.id,
      status: "created",
      type,
      confirmed: item.confirmed,
    });
  },
  {
    name: "create_item",
    description:
      "Create a single item. Type must exist in item_types. Set confirmed=false if approval is required.",
    schema: createItemSchema,
  },
);
