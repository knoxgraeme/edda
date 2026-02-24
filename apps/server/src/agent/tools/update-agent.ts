/**
 * Tool: update_agent — Update an existing agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentDefinitionByName, updateAgentDefinition } from "@edda/db";

export const updateAgentSchema = z.object({
  agent_name: z.string().describe("Name of the agent to update"),
  description: z.string().optional().describe("New description"),
  system_prompt: z.string().optional().describe("New system prompt"),
  skills: z.array(z.string()).optional().describe("New skill list"),
  schedule: z.string().nullable().optional().describe("New cron schedule (null to remove)"),
  enabled: z.boolean().optional().describe("Enable or disable the agent"),
  context_mode: z
    .enum(["isolated", "daily", "persistent"])
    .optional()
    .describe("New thread ID strategy"),
  output_mode: z
    .enum(["channel", "items", "both"])
    .optional()
    .describe("New output mode"),
  scopes: z.array(z.string()).optional().describe("Entity/topic scopes for search boosting"),
  scope_mode: z.enum(["boost", "strict"]).optional().describe("How scopes affect search results"),
  model_settings_key: z
    .string()
    .optional()
    .describe("Settings key for the model to use (e.g., 'daily_digest_model')"),
  metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata for the agent"),
});

export const updateAgentTool = tool(
  async ({ agent_name, ...updates }) => {
    const definition = await getAgentDefinitionByName(agent_name);
    if (!definition) throw new Error(`Agent '${agent_name}' not found`);

    if (definition.built_in) {
      const allowedBuiltInFields = new Set(["schedule", "enabled"]);
      const attemptedFields = Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined);
      const blocked = attemptedFields.filter((f) => !allowedBuiltInFields.has(f));
      if (blocked.length > 0) {
        throw new Error(
          `Cannot modify ${blocked.join(", ")} on built-in agent '${agent_name}'. ` +
          `Only 'schedule' and 'enabled' can be changed on built-in agents.`,
        );
      }
    }

    if (updates.schedule !== undefined && updates.schedule !== null) {
      const cron = await import("node-cron");
      if (!cron.validate(updates.schedule)) {
        throw new Error(`Invalid cron expression: ${updates.schedule}`);
      }
    }

    const updated = await updateAgentDefinition(definition.id, updates);

    return JSON.stringify({
      updated: true,
      name: updated.name,
      enabled: updated.enabled,
      schedule: updated.schedule,
    });
  },
  {
    name: "update_agent",
    description:
      "Update an existing agent definition. Can change schedule, description, enabled status, and more.",
    schema: updateAgentSchema,
  },
);
