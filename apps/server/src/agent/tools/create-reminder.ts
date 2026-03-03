/**
 * Tool: create_reminder — Schedule a future notification (zero-LLM delivery).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createNotification } from "@edda/db";
import { getAgentName } from "../tool-helpers.js";
import { validateRecurrence } from "../../utils/reminder-recurrence.js";

export const createReminderSchema = z.object({
  message: z.string().max(2000).optional().describe("The reminder message to deliver when it fires"),
  summary: z.string().max(2000).optional().describe("Alias for message"),
  scheduled_at: z.string().describe("ISO 8601 datetime (must be in the future)"),
  recurrence: z
    .string()
    .optional()
    .describe("Cron expression (e.g. '0 9 * * 4') or interval (e.g. '1 day'). Omit for one-shot."),
  targets: z
    .array(z.string().regex(/^(inbox|announce:[a-z0-9_-]+)$/i))
    .optional()
    .describe("Delivery targets (default: ['inbox']). Use 'announce:<agent_name>' for channels."),
  priority: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe("Priority (default: normal)"),
});

export const createReminderTool = tool(
  async ({ message, summary, scheduled_at, recurrence, targets, priority }, config) => {
    const resolvedMessage = message ?? summary;
    if (!resolvedMessage) {
      throw new Error("Either 'message' or 'summary' is required");
    }
    const callingAgent = getAgentName(config) ?? "unknown";

    // Validate scheduled_at is in the future
    const scheduledDate = new Date(scheduled_at);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error(`Invalid datetime: ${scheduled_at}. Use ISO 8601 format.`);
    }
    if (scheduledDate <= new Date()) {
      throw new Error("scheduled_at must be in the future");
    }

    // Validate recurrence if provided
    if (recurrence) {
      const error = validateRecurrence(recurrence);
      if (error) throw new Error(error);
    }

    const resolvedTargets = targets ?? ["inbox"];

    const notification = await createNotification({
      source_type: "agent",
      source_id: callingAgent,
      // target_type is always 'inbox' — actual delivery is driven by the targets array
      target_type: "inbox",
      summary: resolvedMessage,
      detail: {
        agent_name: callingAgent,
        reminder: true,
      },
      priority,
      scheduled_at,
      recurrence,
      targets: resolvedTargets,
    });

    return JSON.stringify({
      id: notification.id,
      summary: notification.summary,
      scheduled_at: notification.scheduled_at,
      recurrence: notification.recurrence ?? null,
      targets: resolvedTargets,
    });
  },
  {
    name: "create_reminder",
    description:
      "Schedule a future notification that fires on time without an agent run. " +
      "Supports one-shot ('at 5pm today') and recurring ('every Thursday at 9am') reminders. " +
      "Use cron expressions or interval strings for recurrence.",
    schema: createReminderSchema,
  },
);
