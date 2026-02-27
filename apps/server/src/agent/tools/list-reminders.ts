/**
 * Tool: list_reminders — List upcoming scheduled reminders.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getScheduledReminders } from "@edda/db";

export const listRemindersSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of reminders to return (default: 20)"),
});

export const listRemindersTool = tool(
  async ({ limit }) => {
    const reminders = await getScheduledReminders({ limit: limit ?? 20 });

    return JSON.stringify({
      reminders: reminders.map((r) => ({
        id: r.id,
        summary: r.summary,
        scheduled_at: r.scheduled_at,
        recurrence: r.recurrence,
        targets: r.targets,
        priority: r.priority,
        created_at: r.created_at,
      })),
    });
  },
  {
    name: "list_reminders",
    description:
      "List upcoming scheduled reminders sorted by next fire time. " +
      "Shows reminder ID (for cancellation), summary, next fire time, and recurrence.",
    schema: listRemindersSchema,
  },
);
