/**
 * Tool: update_item — Update an existing item's fields.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { updateItem, getItemById, getSettingsSync } from "@edda/db";
import { embed, buildEmbeddingText } from "../../embed/index.js";

export const updateItemSchema = z.object({
  item_id: z.string().uuid().describe("The ID of the item to update"),
  status: z
    .enum(["active", "done", "archived", "snoozed"])
    .optional()
    .describe("New status for the item"),
  content: z.string().optional().describe("Updated content text"),
  metadata: z.record(z.unknown()).optional().describe("Metadata fields to merge/replace"),
  parent_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe("Parent item ID for hierarchical items (meeting→decision). NOT for lists — use list_id."),
  list_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe("Move item to a list, or null to remove from list"),
});

export const updateItemTool = tool(
  async ({ item_id, status, content, metadata, parent_id, list_id }) => {
    const updates: Parameters<typeof updateItem>[1] = {};

    if (status !== undefined) {
      updates.status = status;
      if (status === "done") {
        updates.completed_at = new Date().toISOString();
      }
    }

    if (content !== undefined) {
      const existing = await getItemById(item_id);
      if (!existing) {
        return JSON.stringify({ error: "Item not found", item_id });
      }
      const settings = getSettingsSync();
      updates.content = content;
      updates.embedding = await embed(buildEmbeddingText(existing.type, content, existing.summary));
      updates.embedding_model = settings.embedding_model;
    }

    if (metadata !== undefined) updates.metadata = metadata;
    if (parent_id !== undefined) updates.parent_id = parent_id;
    if (list_id !== undefined) updates.list_id = list_id;

    const item = await updateItem(item_id, updates);

    if (!item) {
      return JSON.stringify({ error: "Item not found", item_id });
    }

    return JSON.stringify({
      item_id: item.id,
      status: item.status,
      updated_fields: Object.keys(updates),
    });
  },
  {
    name: "update_item",
    description:
      "Update an existing item. Can change status, content, or metadata. Re-embeds if content changes.",
    schema: updateItemSchema,
  },
);
