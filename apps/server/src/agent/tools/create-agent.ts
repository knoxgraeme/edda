/**
 * Tool: create_agent — Create a new background agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAgentDefinition, getAgentDefinitions } from "@edda/db";

export const createAgentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, "Agent name must be snake_case (lowercase letters, digits, underscores; must start with a letter)")
    .describe("Unique agent name (snake_case)"),
  description: z.string().max(500).describe("What this agent does"),
  system_prompt: z.string().max(10000).optional().describe("Custom system prompt (overrides skills)"),
  skills: z
    .array(z.string())
    .max(10)
    .optional()
    .default([])
    .describe("Skill names to use (e.g. ['daily_digest'])"),
  schedule: z
    .string()
    .optional()
    .describe("Cron expression for scheduled runs (e.g. '0 9 * * *')"),
  context_mode: z
    .enum(["isolated", "daily", "persistent"])
    .default("isolated")
    .describe("Thread ID strategy"),
  output_mode: z
    .enum(["channel", "items", "both"])
    .default("channel")
    .describe("Where the agent writes output"),
  scopes: z.array(z.string()).optional().describe("Memory scope tags for visibility"),
  scope_mode: z
    .enum(["boost", "strict"])
    .default("boost")
    .describe("Scope enforcement mode"),
});

export const createAgentTool = tool(
  async ({
    name,
    description,
    system_prompt,
    skills,
    schedule,
    context_mode,
    output_mode,
    scopes,
    scope_mode,
  }) => {
    const existing = await getAgentDefinitions();
    const userAgentCount = existing.filter((a) => !a.built_in).length;
    if (userAgentCount >= 20) {
      throw new Error("Maximum number of user-created agents (20) reached. Delete unused agents first.");
    }

    if (schedule) {
      const cron = await import("node-cron");
      if (!cron.validate(schedule)) {
        throw new Error(`Invalid cron expression: ${schedule}`);
      }
      // Reject overly frequent schedules (more than once per 5 minutes)
      const parts = schedule.split(/\s+/);
      if (parts[0] === "*" || parts[0]?.includes("/")) {
        const interval = parts[0] === "*" ? 1 : parseInt(parts[0].split("/")[1] ?? "1", 10);
        if (interval < 5) {
          throw new Error("Agent schedule cannot run more frequently than every 5 minutes.");
        }
      }
    }

    const agent = await createAgentDefinition({
      name,
      description,
      system_prompt,
      skills: skills ?? [],
      schedule,
      context_mode,
      output_mode,
      scopes: scopes ?? [],
      scope_mode,
    });

    return JSON.stringify({
      created: true,
      agent_id: agent.id,
      name: agent.name,
      schedule: agent.schedule,
    });
  },
  {
    name: "create_agent",
    description:
      "Create a new background agent. It will run on schedule (if cron provided) or on-demand via run_agent.",
    schema: createAgentSchema,
  },
);
