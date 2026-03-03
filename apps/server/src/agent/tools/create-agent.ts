/**
 * Tool: create_agent — Create a new agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAgent, getAgents, saveAgentsMdVersion } from "@edda/db";
import { getLogger } from "../../logger.js";
import { EMPTY_AGENTS_MD_SEED } from "./agents-md-seed.js";

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
    .describe("Skill names to use (e.g. ['daily-digest'])"),
  trigger: z
    .enum(["schedule", "on_demand"])
    .default("on_demand")
    .describe("How this agent is triggered"),
  thread_lifetime: z
    .enum(["ephemeral", "daily", "persistent"])
    .default("ephemeral")
    .describe("ephemeral | daily | persistent"),
  model_provider: z
    .enum(["anthropic", "openai", "google", "groq", "ollama", "mistral", "bedrock"])
    .nullable()
    .optional()
    .describe("LLM provider override (null to use default from settings)"),
  model: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .describe("Model name override (null to use default from settings)"),
  memory_capture: z
    .boolean()
    .optional()
    .default(true)
    .describe("Extract implicit knowledge from conversations (default: true)"),
  memory_self_reflect: z
    .boolean()
    .optional()
    .default(true)
    .describe("Review past sessions and update operating notes on schedule (default: true)"),
  tools: z
    .array(z.string())
    .max(50)
    .optional()
    .default([])
    .describe("Individual tool names to grant (in addition to skill-scoped tools)"),
  subagents: z
    .array(z.string())
    .max(10)
    .optional()
    .default([])
    .describe("Agent names this agent can delegate to"),
  metadata: z
    .record(z.unknown())
    .optional()
    .refine(
      (m) => !m || !Object.keys(m).some((k) => ["stores", "hooks"].includes(k)),
      "Cannot set privileged metadata keys (stores, hooks) via tool",
    )
    .describe("Arbitrary metadata for the agent (e.g. retrieval_context)"),
});

export const createAgentTool = tool(
  async ({
    name,
    description,
    system_prompt,
    skills,
    trigger,
    thread_lifetime,
    model_provider,
    model,
    memory_capture,
    memory_self_reflect,
    tools,
    subagents,
    metadata,
  }) => {
    const existing = await getAgents();
    if (existing.length >= 30) {
      throw new Error("Maximum number of agents (30) reached. Delete unused agents first.");
    }

    // Auto-add self-improvement skill so the agent can refine itself
    const resolvedSkills = skills ?? [];
    if (!resolvedSkills.includes("self-improvement")) {
      resolvedSkills.push("self-improvement");
    }

    const agent = await createAgent({
      name,
      description,
      system_prompt,
      skills: resolvedSkills,
      thread_lifetime,
      trigger,
      tools,
      subagents,
      model_provider,
      model,
      memory_capture,
      memory_self_reflect,
      metadata,
    });

    // Seed an empty AGENTS.md (procedural memory) for the new agent
    try {
      await saveAgentsMdVersion({
        content: EMPTY_AGENTS_MD_SEED,
        agentName: name,
      });
    } catch (err) {
      getLogger().error({ agent: name, err }, "Agent created but AGENTS.md seed failed");
    }

    return JSON.stringify({
      created: true,
      agent_id: agent.id,
      name: agent.name,
      trigger: agent.trigger,
      skills: resolvedSkills,
    });
  },
  {
    name: "create_agent",
    description:
      "Create a new agent definition. Use trigger='schedule' for cron-driven agents, trigger='on_demand' for manually triggered agents.",
    schema: createAgentSchema,
  },
);
