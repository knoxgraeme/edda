/**
 * Tool: create_agent — Create a new agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAgent, getAgents } from "@edda/db";

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
  trigger: z
    .enum(["schedule", "on_demand"])
    .default("on_demand")
    .describe("How this agent is triggered"),
  context_mode: z
    .enum(["isolated", "daily", "persistent"])
    .default("isolated")
    .describe("Thread ID strategy"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Arbitrary metadata for the agent (e.g. retrieval_context)"),
});

export const createAgentTool = tool(
  async ({
    name,
    description,
    system_prompt,
    skills,
    trigger,
    context_mode,
    metadata,
  }) => {
    const existing = await getAgents();
    if (existing.length >= 30) {
      throw new Error("Maximum number of agents (30) reached. Delete unused agents first.");
    }

    const agent = await createAgent({
      name,
      description,
      system_prompt,
      skills: skills ?? [],
      context_mode,
      trigger,
      metadata,
    });

    return JSON.stringify({
      created: true,
      agent_id: agent.id,
      name: agent.name,
      trigger: agent.trigger,
    });
  },
  {
    name: "create_agent",
    description:
      "Create a new agent definition. Use trigger='schedule' for cron-driven agents, trigger='on_demand' for manually triggered agents.",
    schema: createAgentSchema,
  },
);
