/**
 * Tool: cancel_reminder — Cancel a scheduled reminder by ID.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { dismissNotification } from "@edda/db";

export const cancelReminderSchema = z.object({
  id: z.string().uuid().describe("The reminder ID to cancel (from list_reminders)"),
});

export const cancelReminderTool = tool(
  async ({ id }) => {
    const result = await dismissNotification(id);
    if (!result) {
      throw new Error("Reminder not found or already cancelled");
    }
    return JSON.stringify({ cancelled: true, id, summary: result.summary });
  },
  {
    name: "cancel_reminder",
    description: "Cancel a scheduled reminder by its ID. Use list_reminders first to find the ID.",
    schema: cancelReminderSchema,
  },
);
