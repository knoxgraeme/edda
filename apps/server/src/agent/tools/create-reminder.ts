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
  scheduled_at: z
    .string()
    .describe(
      "Datetime in the user's local timezone (e.g. '2026-03-02T15:00:00'). " +
        "Do NOT convert to UTC — pass the time as the user said it. " +
        "The server converts using the timezone parameter.",
    ),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone for scheduled_at (e.g. 'America/New_York'). " +
        "Use the user's timezone from system context. Defaults to UTC.",
    ),
  recurrence: z
    .string()
    .optional()
    .describe(
      "Cron expression (e.g. '0 9 * * 4') or interval (e.g. '1 day'). " +
        "Cron times are in the user's timezone (set via timezone param). Omit for one-shot.",
    ),
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
  async ({ message, summary, scheduled_at, timezone, recurrence, targets, priority }, config) => {
    const resolvedMessage = message ?? summary;
    if (!resolvedMessage) {
      throw new Error("Either 'message' or 'summary' is required");
    }
    const callingAgent = getAgentName(config) ?? "unknown";
    const tz = timezone ?? "UTC";

    // Validate timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      throw new Error(`Invalid timezone: "${tz}". Use an IANA timezone like "America/New_York".`);
    }

    // Convert user-local time to UTC
    // If the input already has a Z or offset, Date parses it directly.
    // Otherwise treat it as local time in the given timezone.
    let scheduledDate: Date;
    if (/Z|[+-]\d{2}:\d{2}$/.test(scheduled_at)) {
      scheduledDate = new Date(scheduled_at);
    } else {
      // Parse as local time in the user's timezone by formatting back to UTC
      // Append a fake offset-free marker so Date doesn't assume UTC
      const localParts = scheduled_at.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
      );
      if (!localParts) {
        throw new Error(
          `Invalid datetime format: "${scheduled_at}". Use "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss".`,
        );
      }
      const [, year, month, day, hour, minute, second] = localParts;
      // Build a date string that we can reliably parse in the target timezone
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      // Get the current UTC offset for the target timezone at roughly the requested time
      const approxDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second || "00"}Z`);
      const parts = formatter.formatToParts(approxDate);
      const tzParts: Record<string, string> = {};
      for (const p of parts) if (p.type !== "literal") tzParts[p.type] = p.value;
      // The offset is: what UTC time displays as in that timezone
      // So the actual UTC time = local time - offset, where offset = tzLocal - UTC
      const utcRef = approxDate.getTime();
      const tzLocal = new Date(
        `${tzParts.year}-${tzParts.month}-${tzParts.day}T${tzParts.hour}:${tzParts.minute}:${tzParts.second}Z`,
      ).getTime();
      const offsetMs = tzLocal - utcRef;
      // The user's local time in UTC = requested time - offset
      scheduledDate = new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second || 0),
        ) - offsetMs,
      );
    }

    if (isNaN(scheduledDate.getTime())) {
      throw new Error(`Invalid datetime: "${scheduled_at}".`);
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
        ...(tz !== "UTC" && { timezone: tz }),
      },
      priority,
      scheduled_at: scheduledDate.toISOString(),
      recurrence,
      targets: resolvedTargets,
    });

    return JSON.stringify({
      id: notification.id,
      summary: notification.summary,
      scheduled_at: notification.scheduled_at,
      recurrence: notification.recurrence ?? null,
      timezone: tz,
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
