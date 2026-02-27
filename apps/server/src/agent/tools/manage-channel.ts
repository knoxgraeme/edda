/**
 * Tool: manage_channel — Create, update, or delete an agent channel.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getAgentByName,
  createChannel,
  updateChannel,
  deleteChannel,
} from "@edda/db";

export const manageChannelSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    agent_name: z.string().describe("Name of the agent to link the channel to"),
    platform: z.enum(["telegram", "slack", "discord"]).describe("Channel platform"),
    external_id: z.string().describe("Platform-specific chat/channel ID"),
    config: z.record(z.unknown()).optional().describe("Platform-specific configuration"),
    enabled: z.boolean().optional().default(true).describe("Whether the channel is enabled"),
    receive_announcements: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether the channel receives proactive announcements"),
  }),
  z.object({
    action: z.literal("update"),
    channel_id: z.string().describe("ID of the channel to update"),
    config: z.record(z.unknown()).optional().describe("Updated platform-specific configuration"),
    enabled: z.boolean().optional().describe("Enable or disable the channel"),
    receive_announcements: z
      .boolean()
      .optional()
      .describe("Whether the channel receives proactive announcements"),
  }),
  z.object({
    action: z.literal("delete"),
    channel_id: z.string().describe("ID of the channel to delete"),
  }),
]);

export const manageChannelTool = tool(
  async (input) => {
    switch (input.action) {
      case "create": {
        const agent = await getAgentByName(input.agent_name);
        if (!agent) throw new Error(`Agent '${input.agent_name}' not found`);

        const channel = await createChannel({
          agent_id: agent.id,
          platform: input.platform,
          external_id: input.external_id,
          config: input.config,
          enabled: input.enabled,
          receive_announcements: input.receive_announcements,
        });
        return JSON.stringify({ created: true, channel });
      }
      case "update": {
        const updates: Record<string, unknown> = {};
        if (input.config !== undefined) updates.config = input.config;
        if (input.enabled !== undefined) updates.enabled = input.enabled;
        if (input.receive_announcements !== undefined)
          updates.receive_announcements = input.receive_announcements;

        const channel = await updateChannel(input.channel_id, updates);
        return JSON.stringify({ updated: true, channel });
      }
      case "delete": {
        await deleteChannel(input.channel_id);
        return JSON.stringify({ deleted: true, channel_id: input.channel_id });
      }
    }
  },
  {
    name: "manage_channel",
    description:
      "Create, update, or delete an agent channel for bidirectional chat routing. Use action 'create' to link a new channel, 'update' to modify settings, or 'delete' to remove a channel.",
    schema: manageChannelSchema,
  },
);
