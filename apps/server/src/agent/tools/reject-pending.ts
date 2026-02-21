/**
 * Tool: reject_pending — Reject a pending item, entity, or item type.
 *
 * For items: if the pending_action indicates a reclassification, reverts to
 * the previous type instead of deleting.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getItemById,
  updateItem,
  rejectPending,
  deleteItemType,
} from "@edda/db";

export const rejectPendingSchema = z.object({
  table: z.enum(["items", "item_types", "entities"]).describe("Which table the row belongs to"),
  id: z.string().describe("Row ID (uuid for items/entities, name for item_types)"),
});

export const rejectPendingTool = tool(
  async ({ table, id }) => {
    if (table === "items") {
      const item = await getItemById(id);
      if (!item) {
        return JSON.stringify({ status: "not_found", table, id });
      }

      const isReclassification =
        item.pending_action?.startsWith("Reclassified") &&
        item.metadata?.previous_type;

      if (isReclassification) {
        await updateItem(id, {
          type: item.metadata.previous_type as string,
          confirmed: true,
          pending_action: null,
        });
        return JSON.stringify({
          status: "reverted",
          table,
          id,
          reverted_to_type: item.metadata.previous_type,
        });
      }

      await rejectPending("items", id);
      return JSON.stringify({ status: "rejected", table, id });
    }

    if (table === "item_types") {
      await deleteItemType(id);
      return JSON.stringify({ status: "rejected", table, id });
    }

    // entities
    await rejectPending("entities", id);
    return JSON.stringify({ status: "rejected", table, id });
  },
  {
    name: "reject_pending",
    description:
      "Reject a pending item, entity, or item type. For reclassified items, reverts to the previous type.",
    schema: rejectPendingSchema,
  },
);
