/**
 * Tool: update_item — Update an existing item's fields.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { updateItem, getSettingsSync } from "@edda/db";
import type { ItemStatus } from "@edda/db";
import { embed } from "../../embed/index.js";

export const updateItemSchema = z.object({
  item_id: z.string().describe("The ID of the item to update"),
  status: z
    .enum(["active", "done", "archived", "snoozed"])
    .optional()
    .describe("New status for the item"),
  content: z.string().optional().describe("Updated content text"),
  metadata: z.record(z.any()).optional().describe("Metadata fields to merge/replace"),
  confirmed: z.boolean().optional().describe("Set confirmation status"),
  pending_action: z.string().nullable().optional().describe("Pending action label or null to clear"),
});

export const updateItemTool = tool(
  async ({ item_id, status, content, metadata, confirmed, pending_action }) => {
    const updates: Record<string, unknown> = {};

    if (status !== undefined) {
      updates.status = status;
      if (status === "done") {
        updates.completed_at = new Date().toISOString();
      }
    }

    if (content !== undefined) {
      const settings = getSettingsSync();
      updates.content = content;
      updates.embedding = await embed(content);
      updates.embedding_model = settings.embedding_model;
    }

    if (metadata !== undefined) updates.metadata = metadata;
    if (confirmed !== undefined) updates.confirmed = confirmed;
    if (pending_action !== undefined) updates.pending_action = pending_action;

    const item = await updateItem(
      item_id,
      updates as Parameters<typeof updateItem>[1],
    );

    if (!item) {
      return JSON.stringify({ error: "Item not found", item_id });
    }

    return JSON.stringify({
      item_id: item.id,
      status: item.status as ItemStatus,
      updated_fields: Object.keys(updates),
    });
  },
  {
    name: "update_item",
    description:
      "Update an existing item. Can change status, content, metadata, or confirmation. Re-embeds if content changes.",
    schema: updateItemSchema,
  },
);
