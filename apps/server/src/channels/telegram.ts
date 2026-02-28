/**
 * Telegram channel adapter — grammY bot implementing ChannelAdapter.
 *
 * Receives messages via Telegram webhook, routes them to the linked agent
 * via handleInboundMessage(), and replies in the same forum topic.
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Bot, type Context, type CommandContext } from "grammy";
import type { Update } from "grammy/types";
import {
  getChannelByExternalId,
  getChannelsByAgent,
  getAgentById,
  getAgentByName,
  getAgentNames,
  getRecentTaskRuns,
  getSettings,
  createChannel,
  deleteChannel,
  getPairedUser,
  createPairingRequest,
} from "@edda/db";
import { getLogger } from "../logger.js";
import { registerAdapter } from "./deliver.js";
import { handleInboundMessage } from "./handle-message.js";
import type { ChannelAdapter, ParsedMessage } from "./adapter.js";

const TELEGRAM_MAX_LENGTH = 4096;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export class TelegramAdapter implements ChannelAdapter {
  readonly platform = "telegram" as const;
  readonly maxMessageLength = TELEGRAM_MAX_LENGTH;

  private bot: Bot | null = null;
  private token: string;
  private webhookSecret: string | undefined;

  constructor(token: string, opts?: { webhookSecret?: string }) {
    this.token = token;
    this.webhookSecret = opts?.webhookSecret;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.bot = new Bot(this.token);
    await this.bot.init();

    // Access control — DB-backed pairing flow
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const paired = await getPairedUser(userId);

      if (paired?.status === "approved") {
        await next();
        return;
      }

      if (paired?.status === "pending") {
        await ctx.reply("Your access request is still waiting for approval.");
        return;
      }

      if (paired?.status === "rejected") {
        getLogger().info({ userId }, "Dropping message from rejected Telegram user");
        return;
      }

      // No pairing row — create a new request
      const displayName =
        [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") ||
        ctx.from.username ||
        undefined;
      await createPairingRequest(userId, displayName);
      getLogger().info({ userId, displayName }, "New Telegram pairing request");
      await ctx.reply(
        "Access requested — waiting for approval. You'll be able to use the bot once an admin approves your request.",
      );
    });

    // Register commands before the catch-all message handler
    this.bot.command("start", (ctx) => this.handleStartCommand(ctx));
    this.bot.command("link", (ctx) => this.handleLinkCommand(ctx));
    this.bot.command("unlink", (ctx) => this.handleUnlinkCommand(ctx));
    this.bot.command("status", (ctx) => this.handleStatusCommand(ctx));

    this.bot.on("message:text", (ctx) => this.handleTextMessage(ctx));

    // Register in the delivery dispatcher
    registerAdapter(this);

    getLogger().info("Telegram adapter initialized");
  }

  async shutdown(): Promise<void> {
    // grammY doesn't require explicit cleanup for webhook mode
    this.bot = null;
    getLogger().info("Telegram adapter shut down");
  }

  // ---------------------------------------------------------------------------
  // Webhook (HTTP inbound)
  // ---------------------------------------------------------------------------

  async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.bot) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Telegram adapter not initialized" }));
      return;
    }

    // Validate secret token
    if (this.webhookSecret) {
      const headerSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;
      if (!validateWebhookSecret(headerSecret, this.webhookSecret)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid secret token" }));
        return;
      }
    }

    let update: Update;
    try {
      const raw = await readBody(req);
      update = JSON.parse(raw);
    } catch (err) {
      getLogger().error({ err }, "Failed to parse Telegram webhook body");
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request body" }));
      return;
    }

    // Process asynchronously — always return 200 for valid Telegram updates
    this.bot.handleUpdate(update).catch((err) => {
      getLogger().error({ err }, "Telegram webhook update processing failed");
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async isAuthorized(platformUserId: string): Promise<boolean> {
    const paired = await getPairedUser(Number(platformUserId));
    return paired?.status === "approved";
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async send(externalId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram adapter not initialized");

    const { chatId, threadId } = parseExternalId(externalId);
    const chunks = splitMessage(text, this.maxMessageLength);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk, {
        message_thread_id: threadId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // UX
  // ---------------------------------------------------------------------------

  async sendTypingIndicator(externalId: string): Promise<void> {
    if (!this.bot) return;
    const { chatId, threadId } = parseExternalId(externalId);
    await this.bot.api.sendChatAction(chatId, "typing", {
      message_thread_id: threadId,
    });
  }

  // ---------------------------------------------------------------------------
  // Webhook registration (Telegram-specific public helper)
  // ---------------------------------------------------------------------------

  async registerWebhook(webhookUrl: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram adapter not initialized");

    await this.bot.api.setWebhook(webhookUrl, {
      allowed_updates: ["message"],
      secret_token: this.webhookSecret,
      drop_pending_updates: true,
    });

    const info = await this.bot.api.getWebhookInfo();
    getLogger().info(
      { url: info.url, pendingUpdates: info.pending_update_count },
      "Telegram webhook registered",
    );
  }

  // ---------------------------------------------------------------------------
  // Bot commands (Telegram-specific)
  // ---------------------------------------------------------------------------

  private async handleStartCommand(ctx: CommandContext<Context>): Promise<void> {
    await ctx.reply(
      "Edda Telegram bridge active.\n\n" +
        "Commands:\n" +
        "/link <agent_name> — Link this topic to an agent\n" +
        "/unlink — Remove the channel link\n" +
        "/status — Show linked agent and recent activity\n\n" +
        "In a forum topic, use /link to connect it to an agent. " +
        "DMs are automatically routed to the default agent.\n\n" +
        "New users must be approved before they can interact with the bot. " +
        "Send any message to request access.",
    );
  }

  private async handleLinkCommand(ctx: CommandContext<Context>): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const threadId = ctx.message?.message_thread_id;
    const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

    const agentName = ctx.match.trim();

    if (!agentName) {
      const names = await getAgentNames();
      await ctx.reply(
        "Usage: /link <agent_name>\n\n" + `Available agents: ${names.join(", ")}`,
        { message_thread_id: threadId },
      );
      return;
    }

    // Check if already linked
    const existing = await getChannelByExternalId("telegram", externalId, {
      includeDisabled: true,
    });
    if (existing) {
      const existingAgent = await getAgentById(existing.agent_id);
      await ctx.reply(
        `This topic is already linked to "${existingAgent?.name ?? "unknown"}". ` +
          `Use /unlink first to change it.`,
        { message_thread_id: threadId },
      );
      return;
    }

    const agent = await getAgentByName(agentName);
    if (!agent) {
      const names = await getAgentNames();
      await ctx.reply(
        `Agent "${agentName}" not found.\n\nAvailable agents: ${names.join(", ")}`,
        { message_thread_id: threadId },
      );
      return;
    }
    if (!agent.enabled) {
      await ctx.reply(`Agent "${agentName}" is currently disabled.`, {
        message_thread_id: threadId,
      });
      return;
    }

    try {
      await createChannel({
        agent_id: agent.id,
        platform: "telegram",
        external_id: externalId,
        config: {
          topic_name:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx.message?.reply_to_message as any)?.forum_topic_created?.name ?? undefined,
          chat_title: ctx.chat?.title ?? undefined,
        },
        enabled: true,
        receive_announcements: false,
      });

      await ctx.reply(
        `Linked to agent "${agent.name}" (${agent.thread_lifetime} thread, ${agent.thread_scope} scope).\n\n` +
          "Messages here will now be routed to this agent.\n\n" +
          "Note: The bot must have Group Privacy disabled (via @BotFather → /mybots → Bot Settings → Group Privacy → Turn off) " +
          "to receive regular messages in group topics. Otherwise only /commands will work.",
        { message_thread_id: threadId },
      );
    } catch (err) {
      getLogger().error({ err }, "Telegram /link failed");
      await ctx.reply("Failed to create channel link. Check server logs for details.", {
        message_thread_id: threadId,
      });
    }
  }

  private async handleUnlinkCommand(ctx: CommandContext<Context>): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const threadId = ctx.message?.message_thread_id;
    const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

    const channel = await getChannelByExternalId("telegram", externalId, {
      includeDisabled: true,
    });
    if (!channel) {
      await ctx.reply("This topic is not linked to any agent.", {
        message_thread_id: threadId,
      });
      return;
    }

    try {
      const agent = await getAgentById(channel.agent_id);
      await deleteChannel(channel.id);
      await ctx.reply(`Unlinked from agent "${agent?.name ?? "unknown"}".`, {
        message_thread_id: threadId,
      });
    } catch (err) {
      getLogger().error({ err }, "Telegram /unlink failed");
      await ctx.reply("Failed to remove channel link. Check server logs for details.", {
        message_thread_id: threadId,
      });
    }
  }

  private async handleStatusCommand(ctx: CommandContext<Context>): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const threadId = ctx.message?.message_thread_id;
    const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

    const channel = await getChannelByExternalId("telegram", externalId);
    if (!channel) {
      await ctx.reply(
        "This topic is not linked to any agent.\nUse /link <agent_name> to set one up.",
        { message_thread_id: threadId },
      );
      return;
    }

    const agent = await getAgentById(channel.agent_id);
    if (!agent) {
      await ctx.reply("Linked agent no longer exists. Use /unlink then /link to fix.", {
        message_thread_id: threadId,
      });
      return;
    }

    const lines: string[] = [
      `Agent: ${agent.name}`,
      `Description: ${agent.description}`,
      `Thread: ${agent.thread_lifetime} / ${agent.thread_scope}`,
      `Announcements: ${channel.receive_announcements ? "enabled" : "disabled"}`,
    ];

    const runs = await getRecentTaskRuns({ agent_name: agent.name, limit: 3 });
    if (runs.length > 0) {
      lines.push("", "Recent runs:");
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

    await ctx.reply(lines.join("\n"), { message_thread_id: threadId });
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleTextMessage(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const chatId = ctx.chat.id;
    const threadId = ctx.message?.message_thread_id;
    const text = ctx.message?.text;

    if (!text) return;

    const log = getLogger();
    log.info({ chatId, threadId: threadId ?? "none" }, "Telegram message received");
    log.debug({ chatId, preview: text.slice(0, 80) }, "Message preview");

    const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

    // For DMs with no channel link, fall back to the default agent
    const settings = await getSettings();
    const fallbackAgentName = !threadId ? settings.default_agent : undefined;

    const parsed: ParsedMessage = {
      text,
      externalId,
      platformUserId: String(ctx.from?.id ?? ""),
      replyContext: { chatId, threadId },
    };

    await handleInboundMessage({
      parsed,
      adapter: this,
      fallbackAgentName,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function parseExternalId(externalId: string): { chatId: number; threadId: number | undefined } {
  const match = externalId.match(/^(-?\d+):(dm|\d+)$/);
  if (!match) throw new Error(`Invalid Telegram external_id format: "${externalId}"`);
  return {
    chatId: Number(match[1]),
    threadId: match[2] === "dm" ? undefined : Number(match[2]),
  };
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength / 2) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength / 2) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

function validateWebhookSecret(
  headerValue: string | undefined,
  expected: string,
): boolean {
  if (!headerValue) return false;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(headerValue);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += (chunk as Buffer).length;
    if (totalSize > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}
