/**
 * Discord channel adapter — discord.js bot implementing ChannelAdapter.
 *
 * Connects via Gateway WebSocket. Listens for messages in channels/threads
 * and routes them to the linked agent via handleInboundMessage().
 * Slash commands: /edda link <agent>, /edda unlink, /edda status.
 */

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ApplicationCommandOptionType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type { Message, ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
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
  addChannelRef,
} from "@edda/db";
import type { PendingAction } from "@edda/db";
import { resolveAndNotify } from "../agent/resolve-action.js";
import { getLogger } from "../logger.js";
import { registerAdapter, unregisterAdapter } from "./deliver.js";
import { handleInboundMessage } from "./handle-message.js";
import { splitMessage } from "./utils.js";
import type { ChannelAdapter, MessageHandle, ParsedMessage } from "./adapter.js";

const DISCORD_MAX_LENGTH = 2000;

export class DiscordAdapter implements ChannelAdapter {
  readonly platform = "discord" as const;
  readonly maxMessageLength = DISCORD_MAX_LENGTH;

  private client: Client | null = null;
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on("messageCreate", (msg) => {
      this.handleTextMessage(msg).catch((err) => {
        getLogger().error({ err }, "Discord message handler failed");
      });
    });

    this.client.on("interactionCreate", (interaction) => {
      if (interaction.isChatInputCommand()) {
        this.handleSlashCommand(interaction).catch((err) => {
          getLogger().error({ err }, "Discord slash command failed");
        });
      } else if (interaction.isButton() && interaction.customId.startsWith("pa:")) {
        this.handleActionButton(interaction).catch((err) => {
          getLogger().error({ err }, "Discord action button failed");
        });
      }
    });

    await this.client.login(this.token);

    // Register /edda slash command globally
    await this.registerSlashCommands();

    registerAdapter(this);
    getLogger().info("Discord adapter initialized");
  }

  async shutdown(): Promise<void> {
    unregisterAdapter(this.platform);
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    getLogger().info("Discord adapter shut down");
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async send(externalId: string, text: string): Promise<void> {
    const channel = await this.resolveChannel(externalId);
    const chunks = splitMessage(text, this.maxMessageLength);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  // ---------------------------------------------------------------------------
  // Streaming outbound
  // ---------------------------------------------------------------------------

  async sendInitial(externalId: string, text: string): Promise<MessageHandle> {
    const channel = await this.resolveChannel(externalId);
    const msg = await channel.send(text);
    return { messageId: msg.id, externalId };
  }

  async editMessage(handle: MessageHandle, text: string): Promise<void> {
    if (!this.client) throw new Error("Discord adapter not initialized");
    const channelId = parseExternalId(handle.externalId);
    try {
      await this.client.rest.patch(Routes.channelMessage(channelId, handle.messageId), {
        body: { content: text, components: [] },
      });
    } catch (err: unknown) {
      // Suppress "message not modified" errors during streaming (matches Telegram adapter pattern)
      if (
        err instanceof Error &&
        "code" in err &&
        ((err as { code: number }).code === 50035 ||
          err.message.includes("Cannot send an empty message"))
      ) {
        return;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // UX
  // ---------------------------------------------------------------------------

  async sendTypingIndicator(externalId: string): Promise<void> {
    try {
      const channel = await this.resolveChannel(externalId);
      await channel.sendTyping();
    } catch {
      // Non-critical — swallow silently
    }
  }

  // ---------------------------------------------------------------------------
  // Slash command registration
  // ---------------------------------------------------------------------------

  private async registerSlashCommands(): Promise<void> {
    if (!this.client?.application?.id) return;

    const rest = new REST({ version: "10" }).setToken(this.token);
    const commands = [
      {
        name: "edda",
        description: "Manage Edda agent connections",
        options: [
          {
            name: "link",
            description: "Link this channel to an Edda agent",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "agent",
                description: "Agent name to link",
                type: ApplicationCommandOptionType.String,
                required: true,
              },
            ],
          },
          {
            name: "unlink",
            description: "Remove the agent link from this channel",
            type: ApplicationCommandOptionType.Subcommand,
          },
          {
            name: "status",
            description: "Show linked agent and recent activity",
            type: ApplicationCommandOptionType.Subcommand,
          },
        ],
      },
    ];

    try {
      await rest.put(Routes.applicationCommands(this.client.application.id), {
        body: commands,
      });
      getLogger().info("Discord slash commands registered");
    } catch (err) {
      getLogger().warn({ err }, "Discord slash command registration failed");
    }
  }

  // ---------------------------------------------------------------------------
  // Slash command handling
  // ---------------------------------------------------------------------------

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Access control — require approved pairing
    const userId = interaction.user.id;
    const paired = await checkPlatformUser("discord", userId);
    if (!paired || paired.status !== "approved") {
      await interaction.reply({
        content: "You must be approved before using Edda commands. Send a message first to request access.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channelId;
    const guildId = interaction.guildId ?? "dm";
    const externalId = `${guildId}:${channelId}`;

    switch (subcommand) {
      case "link":
        await this.handleLinkCommand(interaction, externalId);
        break;
      case "unlink":
        await this.handleUnlinkCommand(interaction, externalId);
        break;
      case "status":
        await this.handleStatusCommand(interaction, externalId);
        break;
      default:
        await interaction.editReply({ content: "Unknown subcommand." });
    }
  }

  private async handleLinkCommand(
    interaction: ChatInputCommandInteraction,
    externalId: string,
  ): Promise<void> {
    const agentName = interaction.options.getString("agent", true).trim();

    const existing = await getChannelByExternalId("discord", externalId, {
      includeDisabled: true,
    });
    if (existing) {
      const existingAgent = await getAgentById(existing.agent_id);
      await interaction.editReply({
        content:
          `This channel is already linked to "${existingAgent?.name ?? "unknown"}". ` +
          `Use \`/edda unlink\` first to change it.`,
      });
      return;
    }

    const agent = await getAgentByName(agentName);
    if (!agent) {
      const names = await getAgentNames();
      await interaction.editReply({
        content: `Agent "${agentName}" not found.\n\nAvailable agents: ${names.join(", ")}`,
      });
      return;
    }
    if (!agent.enabled) {
      await interaction.editReply({
        content: `Agent "${agentName}" is currently disabled.`,
      });
      return;
    }

    try {
      await createChannel({
        agent_id: agent.id,
        platform: "discord",
        external_id: externalId,
        config: {
          guild_id: interaction.guildId ?? undefined,
          channel_name: interaction.channel
            ? "name" in interaction.channel
              ? interaction.channel.name
              : undefined
            : undefined,
        },
        enabled: true,
        receive_announcements: false,
      });

      await interaction.editReply(
        `Linked to agent "${agent.name}" (${agent.thread_lifetime} thread, ${agent.thread_scope} scope).\n\n` +
          "Messages here will now be routed to this agent.",
      );
    } catch (err) {
      getLogger().error({ err }, "Discord /edda link failed");
      await interaction.editReply({ content: "Failed to create channel link. Check server logs for details." });
    }
  }

  private async handleUnlinkCommand(
    interaction: ChatInputCommandInteraction,
    externalId: string,
  ): Promise<void> {
    const channel = await getChannelByExternalId("discord", externalId, {
      includeDisabled: true,
    });
    if (!channel) {
      await interaction.editReply({
        content: "This channel is not linked to any agent.",
      });
      return;
    }

    try {
      const agent = await getAgentById(channel.agent_id);
      await deleteChannel(channel.id);
      await interaction.editReply(`Unlinked from agent "${agent?.name ?? "unknown"}".`);
    } catch (err) {
      getLogger().error({ err }, "Discord /edda unlink failed");
      await interaction.editReply({ content: "Failed to remove channel link. Check server logs for details." });
    }
  }

  private async handleStatusCommand(
    interaction: ChatInputCommandInteraction,
    externalId: string,
  ): Promise<void> {
    const channel = await getChannelByExternalId("discord", externalId);
    if (!channel) {
      await interaction.editReply({
        content:
          "This channel is not linked to any agent.\nUse `/edda link agent:<name>` to set one up.",
      });
      return;
    }

    const agent = await getAgentById(channel.agent_id);
    if (!agent) {
      await interaction.editReply({
        content: "Linked agent no longer exists. Use `/edda unlink` then `/edda link` to fix.",
      });
      return;
    }

    const lines: string[] = [
      `**Agent:** ${agent.name}`,
      `**Description:** ${agent.description}`,
      `**Thread:** ${agent.thread_lifetime} / ${agent.thread_scope}`,
      `**Announcements:** ${channel.receive_announcements ? "enabled" : "disabled"}`,
    ];

    const runs = await getRecentTaskRuns({ agent_name: agent.name, limit: 3 });
    if (runs.length > 0) {
      lines.push("", "**Recent runs:**");
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

    await interaction.editReply(lines.join("\n"));
  }

  // ---------------------------------------------------------------------------
  // Confirmations
  // ---------------------------------------------------------------------------

  async sendActionPrompt(externalId: string, action: PendingAction): Promise<MessageHandle> {
    const channel = await this.resolveChannel(externalId);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pa:approve:${action.id}`)
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`pa:reject:${action.id}`)
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await channel.send({
      content: `Action requires confirmation:\n\n${action.description}`,
      components: [row],
    });

    const handle: MessageHandle = { messageId: msg.id, externalId };

    await addChannelRef(action.id, {
      platform: "discord",
      message_id: handle.messageId,
      external_id: externalId,
    });

    return handle;
  }

  private async handleActionButton(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    if (parts.length !== 3) return;

    // Access control — only approved/paired users may resolve actions
    const paired = await checkPlatformUser("discord", interaction.user.id);
    if (!paired || paired.status !== "approved") {
      await interaction.reply({ content: "You are not authorized to resolve this action.", ephemeral: true });
      return;
    }

    const decision = parts[1] as "approve" | "reject";
    const actionId = parts[2];
    const resolvedDecision = decision === "approve" ? "approved" : "rejected";
    const resolvedBy = `discord:${interaction.user.id}`;

    try {
      await interaction.deferUpdate();
      const result = await resolveAndNotify(actionId, resolvedDecision, resolvedBy);
      if (result) {
        await interaction.editReply({
          content: `${result.action.description}\n\n${resolvedDecision === "approved" ? "Approved" : "Rejected"} by <@${interaction.user.id}>`,
          components: [],
        });
      } else {
        await interaction.editReply({
          content: "This action has already been resolved.",
          components: [],
        });
      }
    } catch (err) {
      getLogger().error({ err, actionId }, "Discord action button handler failed");
    }
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleTextMessage(msg: Message): Promise<void> {
    // Ignore bot messages and system messages
    if (msg.author.bot) return;
    if (!msg.content) return;

    const log = getLogger();

    // Access control — DB-backed pairing flow
    const paired = await checkPlatformUser("discord", msg.author.id);
    if (paired?.status === "pending") {
      await msg.reply("Your access request is still waiting for approval.");
      return;
    }
    if (paired?.status === "rejected") {
      log.info({ userId: msg.author.id }, "Dropping message from rejected Discord user");
      return;
    }
    if (!paired) {
      const displayName = msg.author.displayName || msg.author.username || undefined;
      await requestPlatformPairing("discord", msg.author.id, displayName);
      log.info({ userId: msg.author.id, displayName }, "New Discord pairing request");
      await msg.reply(
        "Access requested — waiting for approval. You'll be able to use the bot once an admin approves your request.",
      );
      return;
    }

    const channelId = msg.channelId;
    const guildId = msg.guildId ?? "dm";
    const externalId = `${guildId}:${channelId}`;

    log.info({ guildId, channelId }, "Discord message received");
    log.debug({ channelId, preview: msg.content.slice(0, 80) }, "Message preview");

    const parsed: ParsedMessage = {
      text: msg.content,
      externalId,
      platformUserId: msg.author.id,
    };

    await handleInboundMessage({
      parsed,
      adapter: this,
      useFallbackAgent: !msg.guildId, // DMs use fallback agent
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveChannel(externalId: string) {
    if (!this.client) throw new Error("Discord adapter not initialized");

    const channelId = parseExternalId(externalId);
    const channel =
      this.client.channels.cache.get(channelId) ?? (await this.client.channels.fetch(channelId));
    if (!channel || !channel.isTextBased() || !channel.isSendable()) {
      throw new Error(`Discord channel ${channelId} not found or not sendable`);
    }
    return channel;
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

/** Parse "{guild_id}:{channel_id}" → channel_id (guild is for scoping, not sending). */
function parseExternalId(externalId: string): string {
  const match = externalId.match(/^[^:]+:(\d+)$/);
  if (!match) throw new Error(`Invalid Discord external_id format: "${externalId}"`);
  return match[1];
}
