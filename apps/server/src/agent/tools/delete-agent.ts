/**
 * Tool: delete_agent — Delete a user-created agent definition.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentDefinitionByName, deleteAgentDefinition } from "@edda/db";

export const deleteAgentSchema = z.object({
  agent_name: z.string().describe("Name of the agent to delete"),
});

export const deleteAgentTool = tool(
  async ({ agent_name }) => {
    const definition = await getAgentDefinitionByName(agent_name);
    if (!definition) throw new Error(`Agent '${agent_name}' not found`);

    await deleteAgentDefinition(definition.id);

    return JSON.stringify({ deleted: true, name: agent_name });
  },
  {
    name: "delete_agent",
    description:
      "Delete a user-created agent definition. Built-in agents cannot be deleted.",
    schema: deleteAgentSchema,
  },
);
