/**
 * Tool: list_channels — List channels linked to an agent.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentByName, getChannelsByAgent } from "@edda/db";

export const listChannelsSchema = z.object({
  agent_name: z.string().describe("Name of the agent to list channels for"),
  platform: z
    .enum(["telegram", "slack", "discord"])
    .optional()
    .describe("Filter by platform"),
  include_disabled: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include disabled channels"),
});

export const listChannelsTool = tool(
  async ({ agent_name, platform, include_disabled }) => {
    const agent = await getAgentByName(agent_name);
    if (!agent) throw new Error(`Agent '${agent_name}' not found`);

    const channels = await getChannelsByAgent(agent.id, {
      platform,
      includeDisabled: include_disabled,
    });
    return JSON.stringify(channels);
  },
  {
    name: "list_channels",
    description:
      "List channels linked to an agent, optionally filtered by platform. Returns channel ID, platform, external ID, config, and status.",
    schema: listChannelsSchema,
  },
);
