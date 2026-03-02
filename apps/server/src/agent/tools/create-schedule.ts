/**
 * Tool: create_schedule — Create a cron schedule for an agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentByName, createSchedule } from "@edda/db";
import { CronExpressionParser } from "cron-parser";

export const createScheduleSchema = z.object({
  agent_name: z.string().min(1).describe("Name of the agent to schedule"),
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, "Schedule name must be snake_case")
    .describe("Unique schedule name (snake_case)"),
  cron: z
    .string()
    .min(1)
    .describe("5-field cron expression (e.g. '0 7 * * *' for daily at 7am)"),
  prompt: z
    .string()
    .min(1)
    .max(5000)
    .describe("User message sent to the agent on each trigger"),
  thread_lifetime: z
    .enum(["ephemeral", "daily", "persistent"])
    .optional()
    .describe("Thread lifetime override for scheduled runs"),
  notify: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Notification targets on completion (e.g. ['inbox', 'announce:edda'])"),
  notify_expires_after: z
    .string()
    .optional()
    .describe("Notification expiry interval (e.g. '72 hours', '1 day')"),
});

export const createScheduleTool = tool(
  async ({ agent_name, name, cron, prompt, thread_lifetime, notify, notify_expires_after }) => {
    const agent = await getAgentByName(agent_name);
    if (!agent) throw new Error(`Agent not found: ${agent_name}`);

    // Validate cron expression
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

    const schedule = await createSchedule({
      agent_id: agent.id,
      name,
      cron,
      prompt,
      thread_lifetime,
      notify,
      notify_expires_after,
    });

    return JSON.stringify({
      created: true,
      schedule_id: schedule.id,
      agent_name,
      name: schedule.name,
      cron: schedule.cron,
    });
  },
  {
    name: "create_schedule",
    description:
      "Create a cron schedule for an agent. The agent will be triggered on the specified schedule with the given prompt.",
    schema: createScheduleSchema,
  },
);
