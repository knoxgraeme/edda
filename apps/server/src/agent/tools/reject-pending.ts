/**
 * Tool: reject_pending — Reject a pending confirmation or reclassification.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getItemById, updateItem, rejectItemConfirmation } from "@edda/db";

export const rejectPendingSchema = z.object({
  id: z.string().describe("The ID of the pending item to reject"),
  table: z.enum(["items", "entities", "item_types"]).optional().describe("Table to operate on"),
});

export const rejectPendingTool = tool(
  async ({ id, table = "items" }) => {
    if (table !== "items") {
      return JSON.stringify({ status: "error", message: `reject for ${table} not yet supported` });
    }

    const item = await getItemById(id);
    if (!item) {
      return JSON.stringify({ status: "not_found", id });
    }

    if (!item.pending_action) {
      return JSON.stringify({ status: "no_pending_action", id });
    }

    const isReclassification =
      item.pending_action === "reclassify" &&
      typeof item.metadata === "object" &&
      item.metadata !== null &&
      "previous_type" in item.metadata &&
      item.metadata.previous_type !== undefined;

    if (isReclassification) {
      const previousType = item.metadata["previous_type"];
      if (typeof previousType !== "string") {
        return JSON.stringify({ status: "error", message: "previous_type metadata is not a string", id });
      }
      await updateItem(id, {
        type: previousType,
        confirmed: true,
        pending_action: null,
      });
      return JSON.stringify({
        status: "reverted",
        table,
        id,
        reverted_to_type: previousType,
      });
    }

    // Not a reclassification — just delete the unconfirmed item
    await rejectItemConfirmation(id);
    return JSON.stringify({ status: "rejected", table, id });
  },
  {
    name: "reject_pending",
    description:
      "Reject a pending item confirmation or reclassification. Reverts reclassifications to previous type; deletes new unconfirmed items.",
    schema: rejectPendingSchema,
  },
);
