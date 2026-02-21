/**
 * Tool: confirm_pending — Confirm a pending item, entity, or item type.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { confirmPending } from "@edda/db";

export const confirmPendingSchema = z.object({
  table: z.enum(["items", "item_types", "entities"]).describe("Which table the row belongs to"),
  id: z.string().describe("Row ID (uuid for items/entities, name for item_types)"),
});

export const confirmPendingTool = tool(
  async ({ table, id }) => {
    await confirmPending(table, id);
    return JSON.stringify({ status: "confirmed", table, id });
  },
  {
    name: "confirm_pending",
    description: "Confirm a pending item, entity, or item type that is awaiting approval.",
    schema: confirmPendingSchema,
  },
);
