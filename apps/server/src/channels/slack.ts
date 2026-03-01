/**
 * Slack channel adapter — Bolt.js app implementing ChannelAdapter.
 *
 * Connects via Socket Mode (no public URL required). Listens for messages
 * and routes them to the linked agent via handleInboundMessage().
 * Slash command: /edda link <agent>, /edda unlink, /edda status.
 */

import { App, type RespondFn } from "@slack/bolt";
import {
  getChannelByExternalId,
  getChannelsByAgent,
  getAgentById,
  getAgentByName,
  getAgentNames,
  getRecentTaskRuns,
  createChannel,
  deleteChannel,
  checkPlatformUser,
  requestPlatformPairing,
} from "@edda/db";
import { getLogger } from "../logger.js";
import { registerAdapter, unregisterAdapter } from "./deliver.js";
import { handleInboundMessage } from "./handle-message.js";
import { splitMessage } from "./utils.js";
import type { ChannelAdapter, MessageHandle, ParsedMessage } from "./adapter.js";

const SLACK_MAX_LENGTH = 4000;

export class SlackAdapter implements ChannelAdapter {
  readonly platform = "slack" as const;
  readonly maxMessageLength = SLACK_MAX_LENGTH;

  private app: App | null = null;
  private botToken: string;
  private appToken: string;

  constructor(botToken: string, appToken: string) {
    this.botToken = botToken;
    this.appToken = appToken;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
    });

    // Listen for messages (non-bot, non-subtype)
    this.app.message(async ({ message }) => {
      if (message.subtype) return;
      if (!("text" in message) || !message.text) return;
      if (!("user" in message) || !message.user) return;

      const teamId = "team" in message ? (message.team as string) : undefined;
      await this.handleTextMessage(message.channel, message.text, message.user, teamId);
    });

    // Slash command: /edda <subcommand> [args]
    this.app.command("/edda", async ({ ack, command, respond }) => {
      await ack();

      // Access control — require approved pairing
      const cmdUserId = command.user_id;
      const cmdPaired = await checkPlatformUser("slack", cmdUserId);
      if (!cmdPaired || cmdPaired.status !== "approved") {
        await respond({
          response_type: "ephemeral",
          text: "You must be approved before using Edda commands. Send a message first to request access.",
        });
        return;
      }

      const parts = command.text.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() ?? "";
      const channelId = command.channel_id;
      const teamId = command.team_id ?? "workspace";
      const externalId = `${teamId}:${channelId}`;

      switch (subcommand) {
        case "link":
          await this.handleLinkCommand(respond, externalId, parts.slice(1).join(" "));
          break;
        case "unlink":
          await this.handleUnlinkCommand(respond, externalId);
          break;
        case "status":
          await this.handleStatusCommand(respond, externalId);
          break;
        default:
          await respond({
            response_type: "ephemeral",
            text:
              "Usage: `/edda <command>`\n\n" +
              "Commands:\n" +
              "  `link <agent_name>` — Link this channel to an agent\n" +
              "  `unlink` — Remove the channel link\n" +
              "  `status` — Show linked agent and recent activity",
          });
      }
    });

    await this.app.start();

    registerAdapter(this);
    getLogger().info("Slack adapter initialized (Socket Mode)");
  }

  async shutdown(): Promise<void> {
    unregisterAdapter(this.platform);
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    getLogger().info("Slack adapter shut down");
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async send(externalId: string, text: string): Promise<void> {
    if (!this.app) throw new Error("Slack adapter not initialized");

    const channelId = parseExternalId(externalId);
    const chunks = splitMessage(text, this.maxMessageLength);
    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({ channel: channelId, text: chunk });
    }
  }

  // ---------------------------------------------------------------------------
  // Streaming outbound
  // ---------------------------------------------------------------------------

  async sendInitial(externalId: string, text: string): Promise<MessageHandle> {
    if (!this.app) throw new Error("Slack adapter not initialized");

    const channelId = parseExternalId(externalId);
    const result = await this.app.client.chat.postMessage({ channel: channelId, text });
    if (!result.ts) throw new Error("Slack chat.postMessage did not return a timestamp");
    return { messageId: result.ts, externalId };
  }

  async editMessage(handle: MessageHandle, text: string): Promise<void> {
    if (!this.app) throw new Error("Slack adapter not initialized");

    const channelId = parseExternalId(handle.externalId);
    await this.app.client.chat.update({
      channel: channelId,
      ts: handle.messageId,
      text,
    });
  }

  // sendTypingIndicator intentionally omitted — not available for Slack bots.

  // ---------------------------------------------------------------------------
  // Slash command handling
  // ---------------------------------------------------------------------------

  private async handleLinkCommand(
    respond: RespondFn,
    externalId: string,
    agentName: string,
  ): Promise<void> {
    if (!agentName) {
      const names = await getAgentNames();
      await respond({
        response_type: "ephemeral",
        text: `Usage: \`/edda link <agent_name>\`\n\nAvailable agents: ${names.join(", ")}`,
      });
      return;
    }

    const existing = await getChannelByExternalId("slack", externalId, { includeDisabled: true });
    if (existing) {
      const existingAgent = await getAgentById(existing.agent_id);
      await respond({
        response_type: "ephemeral",
        text:
          `This channel is already linked to "${existingAgent?.name ?? "unknown"}". ` +
          `Use \`/edda unlink\` first to change it.`,
      });
      return;
    }

    const agent = await getAgentByName(agentName.trim());
    if (!agent) {
      const names = await getAgentNames();
      await respond({
        response_type: "ephemeral",
        text: `Agent "${agentName}" not found.\n\nAvailable agents: ${names.join(", ")}`,
      });
      return;
    }
    if (!agent.enabled) {
      await respond({
        response_type: "ephemeral",
        text: `Agent "${agentName}" is currently disabled.`,
      });
      return;
    }

    try {
      await createChannel({
        agent_id: agent.id,
        platform: "slack",
        external_id: externalId,
        config: {},
        enabled: true,
        receive_announcements: false,
      });

      await respond({
        response_type: "in_channel",
        text:
          `Linked to agent "${agent.name}" (${agent.thread_lifetime} thread, ${agent.thread_scope} scope).\n\n` +
          "Messages here will now be routed to this agent.",
      });
    } catch (err) {
      getLogger().error({ err }, "Slack /edda link failed");
      await respond({
        response_type: "ephemeral",
        text: "Failed to create channel link. Check server logs for details.",
      });
    }
  }

  private async handleUnlinkCommand(
    respond: RespondFn,
    externalId: string,
  ): Promise<void> {
    const channel = await getChannelByExternalId("slack", externalId, { includeDisabled: true });
    if (!channel) {
      await respond({
        response_type: "ephemeral",
        text: "This channel is not linked to any agent.",
      });
      return;
    }

    try {
      const agent = await getAgentById(channel.agent_id);
      await deleteChannel(channel.id);
      await respond({
        response_type: "in_channel",
        text: `Unlinked from agent "${agent?.name ?? "unknown"}".`,
      });
    } catch (err) {
      getLogger().error({ err }, "Slack /edda unlink failed");
      await respond({
        response_type: "ephemeral",
        text: "Failed to remove channel link. Check server logs for details.",
      });
    }
  }

  private async handleStatusCommand(
    respond: RespondFn,
    externalId: string,
  ): Promise<void> {
    const channel = await getChannelByExternalId("slack", externalId);
    if (!channel) {
      await respond({
        response_type: "ephemeral",
        text: "This channel is not linked to any agent.\nUse `/edda link <agent_name>` to set one up.",
      });
      return;
    }

    const agent = await getAgentById(channel.agent_id);
    if (!agent) {
      await respond({
        response_type: "ephemeral",
        text: "Linked agent no longer exists. Use `/edda unlink` then `/edda link` to fix.",
      });
      return;
    }

    const lines: string[] = [
      `*Agent:* ${agent.name}`,
      `*Description:* ${agent.description}`,
      `*Thread:* ${agent.thread_lifetime} / ${agent.thread_scope}`,
      `*Announcements:* ${channel.receive_announcements ? "enabled" : "disabled"}`,
    ];

    const runs = await getRecentTaskRuns({ agent_name: agent.name, limit: 3 });
    if (runs.length > 0) {
      lines.push("", "*Recent runs:*");
      for (const run of runs) {
        const when = run.completed_at
          ? new Date(run.completed_at).toLocaleString()
          : run.started_at
            ? `started ${new Date(run.started_at).toLocaleString()}`
            : "pending";
        lines.push(`  ${run.status} (${run.trigger}) — ${when}`);
      }
    }

    const allChannels = await getChannelsByAgent(agent.id);
    if (allChannels.length > 1) {
      lines.push("", `Total channels for ${agent.name}: ${allChannels.length}`);
    }

    await respond({
      response_type: "ephemeral",
      text: lines.join("\n"),
    });
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleTextMessage(
    channelId: string,
    text: string,
    userId: string,
    teamId?: string,
  ): Promise<void> {
    const log = getLogger();

    // Access control — DB-backed pairing flow
    const paired = await checkPlatformUser("slack", userId);
    if (paired?.status === "pending") {
      await this.replyEphemeral(channelId, userId, "Your access request is still waiting for approval.");
      return;
    }
    if (paired?.status === "rejected") {
      log.info({ userId }, "Dropping message from rejected Slack user");
      return;
    }
    if (!paired) {
      await requestPlatformPairing("slack", userId);
      log.info({ userId }, "New Slack pairing request");
      await this.replyEphemeral(
        channelId,
        userId,
        "Access requested — waiting for approval. You'll be able to use the bot once an admin approves your request.",
      );
      return;
    }

    // Slack DM channel IDs start with "D"
    const isDM = channelId.startsWith("D");
    const prefix = teamId ?? "workspace";
    const externalId = `${prefix}:${channelId}`;

    log.info({ channelId, isDM }, "Slack message received");
    log.debug({ channelId, preview: text.slice(0, 80) }, "Message preview");

    const parsed: ParsedMessage = {
      text,
      externalId,
      platformUserId: userId,
    };

    await handleInboundMessage({
      parsed,
      adapter: this,
      useFallbackAgent: isDM,
    });
  }

  private async replyEphemeral(channelId: string, userId: string, text: string): Promise<void> {
    if (!this.app) return;
    await this.app.client.chat.postEphemeral({ channel: channelId, user: userId, text });
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

/** Parse "{workspace_or_team}:{channel_id}" → channel_id. */
function parseExternalId(externalId: string): string {
  const parts = externalId.split(":");
  if (parts.length !== 2 || !parts[1]) {
    throw new Error(`Invalid Slack external_id format: "${externalId}"`);
  }
  return parts[1];
}

