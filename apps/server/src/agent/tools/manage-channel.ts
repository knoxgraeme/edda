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

export const manageChannelSchema = z.object({
  action: z.enum(["create", "update", "delete"]).describe("Action to perform"),
  agent_name: z.string().optional().describe("Name of the agent (required for 'create')"),
  platform: z
    .enum(["telegram", "slack", "discord"])
    .optional()
    .describe("Channel platform (required for 'create')"),
  external_id: z.string().optional().describe("Platform-specific chat/channel ID (required for 'create')"),
  channel_id: z.string().optional().describe("ID of the channel (required for 'update' and 'delete')"),
  config: z.record(z.unknown()).optional().describe("Platform-specific configuration"),
  enabled: z.boolean().optional().describe("Whether the channel is enabled (default: true for create)"),
  receive_announcements: z
    .boolean()
    .optional()
    .describe("Whether the channel receives proactive announcements"),
});

export const manageChannelTool = tool(
  async (input) => {
    switch (input.action) {
      case "create": {
        if (!input.agent_name) throw new Error("agent_name is required for 'create'");
        if (!input.platform) throw new Error("platform is required for 'create'");
        if (!input.external_id) throw new Error("external_id is required for 'create'");

        const agent = await getAgentByName(input.agent_name);
        if (!agent) throw new Error(`Agent '${input.agent_name}' not found`);

        const channel = await createChannel({
          agent_id: agent.id,
          platform: input.platform,
          external_id: input.external_id,
          config: input.config,
          enabled: input.enabled ?? true,
          receive_announcements: input.receive_announcements ?? false,
        });
        return JSON.stringify({ created: true, channel });
      }
      case "update": {
        if (!input.channel_id) throw new Error("channel_id is required for 'update'");

        const updates: Record<string, unknown> = {};
        if (input.config !== undefined) updates.config = input.config;
        if (input.enabled !== undefined) updates.enabled = input.enabled;
        if (input.receive_announcements !== undefined)
          updates.receive_announcements = input.receive_announcements;

        const channel = await updateChannel(input.channel_id, updates);
        return JSON.stringify({ updated: true, channel });
      }
      case "delete": {
        if (!input.channel_id) throw new Error("channel_id is required for 'delete'");
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
