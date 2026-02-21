/**
 * Tool: create_item — Create a single item in the knowledge base.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createItem, getSettingsSync } from "@edda/db";
import { embed } from "../../embed/index.js";

export const createItemSchema = z.object({
  type: z.string().describe("The item type (e.g. note, task, event, preference)"),
  content: z.string().describe("The main content text"),
  summary: z.string().optional().describe("A short summary of the content"),
  metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata for the item"),
  day: z.string().optional().describe("Date for the item (YYYY-MM-DD). Defaults to today."),
  status: z
    .enum(["active", "done", "archived", "snoozed"])
    .optional()
    .describe("Item status (default: active)"),
  parent_id: z.string().optional().describe("Parent item ID for hierarchical items"),
});

export const createItemTool = tool(
  async ({ type, content, summary, metadata, day, status, parent_id }) => {
    const settings = getSettingsSync();
    const embedding = await embed(content);

    const item = await createItem({
      type,
      content,
      summary,
      metadata,
      day,
      status,
      parent_id,
      embedding,
      embedding_model: settings.embedding_model,
      source: "chat",
    });

    return JSON.stringify({
      id: item.id,
      type: item.type,
      status: item.status,
      day: item.day,
    });
  },
  {
    name: "create_item",
    description:
      "Create a new item in the knowledge base. Automatically generates an embedding for semantic search.",
    schema: createItemSchema,
  },
);
