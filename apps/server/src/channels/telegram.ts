/**
 * Telegram channel adapter — grammY bot with webhook handling.
 *
 * Receives messages via Telegram webhook, routes them to the linked agent
 * via the shared agent cache, and replies in the same forum topic.
 * Also exports sendToTelegram() for proactive announcement delivery.
 */

import { timingSafeEqual } from "node:crypto";
import { Bot, type Context, type CommandContext } from "grammy";
import type { Update } from "grammy/types";
import {
  getChannelByExternalId,
  getChannelsByAgent,
  getAgentById,
  getAgentByName,
  getAgentNames,
  getRecentTaskRuns,
  createChannel,
  deleteChannel,
  getSettings,
  getPairedUser,
  createPairingRequest,
} from "@edda/db";
import type { Agent } from "@edda/db";
import { resolveThreadId } from "../agent/build-agent.js";
import { getOrBuildAgent } from "../agent/agent-cache.js";
import { extractLastAssistantMessage } from "../agent/tool-helpers.js";
import { withTimeout } from "../utils/with-timeout.js";
import { registerSender } from "./deliver.js";
import { getLogger, withTraceId } from "../logger.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TELEGRAM_MAX_LENGTH = 4096;

let bot: Bot | null = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function initTelegram(token: string): Promise<Bot> {
  bot = new Bot(token);
  await bot.init();

  // Access control — DB-backed pairing flow
  bot.use(async (ctx, next) => {
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
  bot.command("start", handleStartCommand);
  bot.command("link", handleLinkCommand);
  bot.command("unlink", handleUnlinkCommand);
  bot.command("status", handleStatusCommand);

  bot.on("message:text", (ctx) => handleTextMessage(ctx));

  // Register the sender for proactive delivery
  registerSender({
    platform: "telegram",
    send: sendToTelegram,
  });

  getLogger().info("Telegram bot initialized");
  return bot;
}

/**
 * Register the webhook URL with Telegram.
 * Called once on server start when TELEGRAM_BOT_TOKEN is set.
 */
export async function registerWebhook(webhookUrl: string, secret?: string): Promise<void> {
  if (!bot) throw new Error("Telegram bot not initialized");

  await bot.api.setWebhook(webhookUrl, {
    allowed_updates: ["message"],
    secret_token: secret,
    drop_pending_updates: true,
  });

  const info = await bot.api.getWebhookInfo();
  getLogger().info({ url: info.url, pendingUpdates: info.pending_update_count }, "Telegram webhook registered");
}

/**
 * Process a raw Telegram webhook update.
 * Called by the HTTP server route handler.
 */
export async function handleWebhookUpdate(update: Update): Promise<void> {
  if (!bot) throw new Error("Telegram bot not initialized");
  await bot.handleUpdate(update);
}

/**
 * Validate the X-Telegram-Bot-Api-Secret-Token header.
 */
export function validateWebhookSecret(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue) return false;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(headerValue);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

// ---------------------------------------------------------------------------
// Bot commands
// ---------------------------------------------------------------------------

async function handleStartCommand(ctx: CommandContext<Context>): Promise<void> {
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

async function handleLinkCommand(ctx: CommandContext<Context>): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const threadId = ctx.message?.message_thread_id;
  const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

  // ctx.match is the text after "/link" (with @botname already stripped by grammY)
  const agentName = ctx.match.trim();

  if (!agentName) {
    const names = await getAgentNames();
    await ctx.reply(
      "Usage: /link <agent_name>\n\n" +
        `Available agents: ${names.join(", ")}`,
      { message_thread_id: threadId },
    );
    return;
  }

  // Check if already linked (include disabled channels — UNIQUE constraint prevents duplicates)
  const existing = await getChannelByExternalId("telegram", externalId, { includeDisabled: true });
  if (existing) {
    const existingAgent = await getAgentById(existing.agent_id);
    await ctx.reply(
      `This topic is already linked to "${existingAgent?.name ?? "unknown"}". ` +
        `Use /unlink first to change it.`,
      { message_thread_id: threadId },
    );
    return;
  }

  // Validate agent exists and is enabled
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

  // Create the channel link
  try {
    await createChannel({
      agent_id: agent.id,
      platform: "telegram",
      external_id: externalId,
      config: {
        // reply_to_message in forum topics points to the topic creation service message,
        // but forum_topic_created is not always included in the serialized message.
        // Fall back to the is_topic_message flag to at least note this is a topic link.
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

async function handleUnlinkCommand(ctx: CommandContext<Context>): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const threadId = ctx.message?.message_thread_id;
  const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

  const channel = await getChannelByExternalId("telegram", externalId, { includeDisabled: true });
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

async function handleStatusCommand(ctx: CommandContext<Context>): Promise<void> {
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

  // Build status lines
  const lines: string[] = [
    `Agent: ${agent.name}`,
    `Description: ${agent.description}`,
    `Thread: ${agent.thread_lifetime} / ${agent.thread_scope}`,
    `Announcements: ${channel.receive_announcements ? "enabled" : "disabled"}`,
  ];

  // Recent runs
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

  // Other channels for this agent
  const allChannels = await getChannelsByAgent(agent.id);
  if (allChannels.length > 1) {
    lines.push("", `Total channels for ${agent.name}: ${allChannels.length}`);
  }

  await ctx.reply(lines.join("\n"), { message_thread_id: threadId });
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handleTextMessage(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const chatId = ctx.chat.id;
  const threadId = ctx.message?.message_thread_id;
  const text = ctx.message?.text;

  if (!text) return;

  const log = getLogger();
  log.info({ chatId, threadId: threadId ?? "none" }, "Telegram message received");
  log.debug({ chatId, preview: text.slice(0, 80) }, "Message preview");

  // Build external_id: "{chat_id}:{thread_id}" for topics, "{chat_id}:dm" for DMs
  const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

  // Look up channel → agent mapping
  let agentDef: Agent | null = null;
  const channel = await getChannelByExternalId("telegram", externalId);

  if (channel) {
    // Known channel — look up the linked agent by ID
    const found = await getAgentById(channel.agent_id);
    if (found?.enabled) {
      agentDef = found;
    }
  }

  if (!agentDef) {
    // Fallback: DMs or unlinked topics → default agent
    if (channel) {
      // Channel exists but agent is disabled/missing
      await ctx.reply("The agent linked to this topic is currently unavailable.");
      return;
    }

    // No channel row — try default agent for DMs
    if (!threadId) {
      const settings = await getSettings();
      const fallback = await getAgentByName(settings.default_agent);
      if (fallback?.enabled) {
        agentDef = fallback;
      }
    }

    if (!agentDef) {
      await ctx.reply("This topic isn't linked to an agent.");
      return;
    }
  }

  // Send typing indicator and refresh it every 4s
  let typingFailLogged = false;
  const typingInterval = setInterval(() => {
    ctx.api
      .sendChatAction(chatId, "typing", {
        message_thread_id: threadId,
      })
      .catch((err: Error) => {
        if (!typingFailLogged) {
          typingFailLogged = true;
          getLogger().warn({ chatId, err }, "Typing indicator failed");
        }
      });
  }, 4000);

  try {
    await withTraceId({ module: "telegram", chatId, agent: agentDef.name }, async () => {
      await ctx.api.sendChatAction(chatId, "typing", {
        message_thread_id: threadId,
      });

      const state = await getOrBuildAgent(agentDef.name);
      if (!state) {
        await sendSplitMessage(ctx, "The agent is currently unavailable.", threadId);
        return;
      }

      const settings = await getSettings();
      const agentThreadId = resolveThreadId(agentDef, {
        platform: "telegram",
        external_id: externalId,
      }, { timezone: settings.user_timezone });

      const result: { messages?: Array<{ role?: string; content?: unknown; _getType?: () => string }> } = await withTimeout(
        state.agent.invoke(
          { messages: [{ role: "user", content: text }] },
          {
            configurable: {
              thread_id: agentThreadId,
              agent_name: agentDef.name,
              retrieval_context: state.retrievalContext,
            },
          },
        ),
        AGENT_TIMEOUT_MS,
        agentDef.name,
      );

      const lastMsg = extractLastAssistantMessage(result);
      if (lastMsg) {
        await sendSplitMessage(ctx, lastMsg, threadId);
      }
    });
  } catch (err) {
    getLogger().error({ err, chatId, agent: agentDef.name }, "Telegram agent invocation failed");
    await ctx.reply("Sorry, something went wrong processing your message.", {
      message_thread_id: threadId,
    });
  } finally {
    clearInterval(typingInterval);
  }
}

// ---------------------------------------------------------------------------
// Proactive sends
// ---------------------------------------------------------------------------

/**
 * Send a message to a Telegram channel (for announcement delivery).
 * externalId format: "{chat_id}:{thread_id}" or "{chat_id}:dm"
 */
async function sendToTelegram(externalId: string, text: string): Promise<void> {
  if (!bot) throw new Error("Telegram bot not initialized");

  const match = externalId.match(/^(-?\d+):(dm|\d+)$/);
  if (!match) throw new Error(`Invalid Telegram external_id format: "${externalId}"`);
  const chatId = Number(match[1]);
  const threadId = match[2] === "dm" ? undefined : Number(match[2]);

  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await bot.api.sendMessage(chatId, chunk, {
      message_thread_id: threadId,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    if (splitAt < TELEGRAM_MAX_LENGTH / 2) {
      // No good newline break — split at space
      splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt < TELEGRAM_MAX_LENGTH / 2) {
      // No good break point — hard split
      splitAt = TELEGRAM_MAX_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

async function sendSplitMessage(
  ctx: { reply: (text: string, opts?: Record<string, unknown>) => Promise<unknown> },
  text: string,
  threadId?: number,
): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { message_thread_id: threadId });
  }
}
