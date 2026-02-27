/**
 * Tool: list_agents — List all agent definitions.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgents } from "@edda/db";

export const listAgentsSchema = z.object({
  include_disabled: z
    .boolean()
    .default(false)
    .describe("Include disabled agents in the listing"),
});

export const listAgentsTool = tool(
  async ({ include_disabled }) => {
    const agents = include_disabled
      ? await getAgents()
      : await getAgents({ enabled: true });

    return JSON.stringify(
      agents.map((a) => ({
        name: a.name,
        description: a.description,
        enabled: a.enabled,
        trigger: a.trigger,
        thread_lifetime: a.thread_lifetime,
        skills: a.skills,
      })),
    );
  },
  {
    name: "list_agents",
    description:
      "List all agent definitions with their status. Use to discover available agents.",
    schema: listAgentsSchema,
  },
);
