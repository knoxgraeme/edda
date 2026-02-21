/**
 * Tool: reject_pending — Reject a pending confirmation or reclassification.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getItemById, updateItem, rejectPending } from "@edda/db";

export const rejectPendingSchema = z.object({
  id: z.string().describe("The ID of the pending item to reject"),
  table: z.enum(["items", "entities", "item_types"]).optional().describe("Table to operate on"),
});

export const rejectPendingTool = tool(
  async ({ id, table = "items" }) => {
    // Special handling for items with reclassification
    if (table === "items") {
      const item = await getItemById(id);
      if (!item) {
        return JSON.stringify({ status: "not_found", id });
      }

      if (
        item.pending_action === "reclassify" &&
        typeof item.metadata === "object" &&
        item.metadata !== null &&
        "previous_type" in item.metadata &&
        item.metadata.previous_type !== undefined
      ) {
        const previousType = item.metadata.previous_type;
        if (typeof previousType === "string") {
          await updateItem(id, {
            type: previousType,
            confirmed: true,
            pending_action: null,
            metadata: { ...item.metadata, previous_type: undefined },
          });
          return JSON.stringify({
            status: "reverted",
            table,
            id,
            reverted_to_type: previousType,
          });
        }
      }
    }

    // For all tables: use unified reject
    await rejectPending(table, id);
    return JSON.stringify({ status: "rejected", table, id });
  },
  {
    name: "reject_pending",
    description:
      "Reject a pending item confirmation or reclassification. Reverts reclassifications to previous type; deletes new unconfirmed items, entities, or item types.",
    schema: rejectPendingSchema,
  },
);
