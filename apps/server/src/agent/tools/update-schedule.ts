/**
 * Tool: update_schedule — Update an existing agent schedule.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { updateSchedule } from "@edda/db";
import { CronExpressionParser } from "cron-parser";

export const updateScheduleSchema = z.object({
  schedule_id: z.string().uuid().describe("ID of the schedule to update"),
  cron: z
    .string()
    .optional()
    .describe("New 5-field cron expression"),
  prompt: z
    .string()
    .max(5000)
    .optional()
    .describe("New prompt for the scheduled run"),
  thread_lifetime: z
    .enum(["ephemeral", "daily", "persistent"])
    .optional()
    .describe("New thread lifetime"),
  notify: z
    .array(z.string())
    .optional()
    .describe("New notification targets"),
  notify_expires_after: z
    .string()
    .nullable()
    .optional()
    .describe("New notification expiry interval (null to disable)"),
  enabled: z.boolean().optional().describe("Enable or disable the schedule"),
});

export const updateScheduleTool = tool(
  async ({ schedule_id, cron, prompt, thread_lifetime, notify, notify_expires_after, enabled }) => {
    const hasUpdates = [cron, prompt, thread_lifetime, notify, notify_expires_after, enabled].some(
      (v) => v !== undefined,
    );
    if (!hasUpdates) {
      throw new Error("No update fields provided. Specify at least one field to update.");
    }

    if (cron) {
      let parsed;
      try {
        parsed = CronExpressionParser.parse(cron);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid cron expression '${cron}': ${detail}`);
      }

      // Enforce minimum 5-minute interval
      const first = parsed.next().toDate();
      const second = parsed.next().toDate();
      const intervalMs = second.getTime() - first.getTime();
      if (intervalMs < 5 * 60 * 1000) {
        throw new Error(
          `Schedule interval must be at least 5 minutes (got ~${Math.round(intervalMs / 60000)}m). Use a less frequent cron expression.`,
        );
      }
    }

    const schedule = await updateSchedule(schedule_id, {
      cron,
      prompt,
      thread_lifetime,
      notify,
      notify_expires_after,
      enabled,
    });

    return JSON.stringify({
      updated: true,
      schedule_id: schedule.id,
      name: schedule.name,
      cron: schedule.cron,
      enabled: schedule.enabled,
    });
  },
  {
    name: "update_schedule",
    description: "Update an existing agent schedule's cron expression, prompt, or configuration.",
    schema: updateScheduleSchema,
  },
);
