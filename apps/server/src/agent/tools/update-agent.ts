/**
 * Tool: update_agent — Update an existing agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentByName, updateAgent, modifyAgentTools, LLM_PROVIDERS } from "@edda/db";
import { invalidateAgent } from "../agent-cache.js";

export const updateAgentSchema = z.object({
  agent_name: z.string().describe("Name of the agent to update"),
  description: z.string().optional().describe("New description"),
  system_prompt: z.string().optional().describe("New system prompt"),
  skills: z.array(z.string()).optional().describe("New skill list"),
  enabled: z.boolean().optional().describe("Enable or disable the agent"),
  thread_lifetime: z
    .enum(["ephemeral", "daily", "persistent"])
    .optional()
    .describe("ephemeral | daily | persistent"),
  model_provider: z
    .enum(LLM_PROVIDERS)
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
    .describe("Extract implicit knowledge from conversations"),
  memory_self_reflect: z
    .boolean()
    .optional()
    .describe("Review past sessions and update operating notes on schedule"),
  metadata: z
    .record(z.unknown())
    .optional()
    .refine(
      (m) => !m || !Object.keys(m).some((k) => ["stores", "hooks"].includes(k)),
      "Cannot set privileged metadata keys (stores, hooks) via tool",
    )
    .describe("Arbitrary metadata for the agent"),
  subagents: z
    .array(z.string())
    .optional()
    .describe(
      "Agent names this agent may delegate to via the task tool. Pass a full list to replace the current set.",
    ),
  add_tools: z
    .array(z.string())
    .optional()
    .describe("Tool names to add"),
  remove_tools: z
    .array(z.string())
    .optional()
    .describe("Tool names to remove"),
});

export const updateAgentTool = tool(
  async ({ agent_name, add_tools, remove_tools, ...updates }) => {
    const definition = await getAgentByName(agent_name);
    if (!definition) throw new Error(`Agent '${agent_name}' not found`);

    // Handle add/remove tools atomically if provided
    let updated = definition;
    if (add_tools?.length || remove_tools?.length) {
      updated = await modifyAgentTools(definition.id, {
        add: add_tools,
        remove: remove_tools,
      });
    }

    // Apply other updates if any
    const otherUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(otherUpdates).length > 0) {
      updated = await updateAgent(definition.id, otherUpdates);
    }

    // Invalidate the cached agent so changes take effect on next use
    invalidateAgent(updated.name);

    return JSON.stringify({
      updated: true,
      name: updated.name,
      enabled: updated.enabled,
      tools: updated.tools,
    });
  },
  {
    name: "update_agent",
    description:
      "Update an existing agent definition. Can change description, enabled status, skills, subagents, and more. Use add_tools/remove_tools to grant or revoke tool access (e.g. MCP tools).",
    schema: updateAgentSchema,
  },
);
