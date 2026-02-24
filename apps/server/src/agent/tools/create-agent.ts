/**
 * Tool: create_agent — Create a new background agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAgentDefinition } from "@edda/db";

export const createAgentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .describe("Unique agent name (snake_case)"),
  description: z.string().describe("What this agent does"),
  system_prompt: z.string().optional().describe("Custom system prompt (overrides skills)"),
  skills: z
    .array(z.string())
    .optional()
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
    if (schedule) {
      const cron = await import("node-cron");
      if (!cron.validate(schedule)) {
        throw new Error(`Invalid cron expression: ${schedule}`);
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
