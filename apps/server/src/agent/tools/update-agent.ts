/**
 * Tool: update_agent — Update an existing agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentByName, updateAgent } from "@edda/db";

export const updateAgentSchema = z.object({
  agent_name: z.string().describe("Name of the agent to update"),
  description: z.string().optional().describe("New description"),
  system_prompt: z.string().optional().describe("New system prompt"),
  skills: z.array(z.string()).optional().describe("New skill list"),
  enabled: z.boolean().optional().describe("Enable or disable the agent"),
  context_mode: z
    .enum(["isolated", "daily", "persistent"])
    .optional()
    .describe("New thread ID strategy"),
  model_settings_key: z
    .string()
    .optional()
    .describe("Settings key for the model to use (e.g., 'daily_digest_model')"),
  metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata for the agent"),
});

export const updateAgentTool = tool(
  async ({ agent_name, ...updates }) => {
    const definition = await getAgentByName(agent_name);
    if (!definition) throw new Error(`Agent '${agent_name}' not found`);

    const updated = await updateAgent(definition.id, updates);

    return JSON.stringify({
      updated: true,
      name: updated.name,
      enabled: updated.enabled,
    });
  },
  {
    name: "update_agent",
    description:
      "Update an existing agent definition. Can change description, enabled status, skills, and more.",
    schema: updateAgentSchema,
  },
);
