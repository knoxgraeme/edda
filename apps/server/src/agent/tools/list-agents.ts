/**
 * Tool: list_agents — List all agent definitions.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentDefinitions } from "@edda/db";

export const listAgentsSchema = z.object({
  include_disabled: z
    .boolean()
    .default(false)
    .describe("Include disabled agents in the listing"),
});

export const listAgentsTool = tool(
  async ({ include_disabled }) => {
    const agents = include_disabled
      ? await getAgentDefinitions()
      : await getAgentDefinitions({ enabled: true });

    return JSON.stringify(
      agents.map((a) => ({
        name: a.name,
        description: a.description,
        schedule: a.schedule,
        enabled: a.enabled,
        built_in: a.built_in,
        context_mode: a.context_mode,
        output_mode: a.output_mode,
        skills: a.skills,
      })),
    );
  },
  {
    name: "list_agents",
    description:
      "List all agent definitions with their schedules and status. Use to discover available agents.",
    schema: listAgentsSchema,
  },
);
