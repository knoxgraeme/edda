/**
 * Telegram channel adapter — grammY bot with webhook handling.
 *
 * Receives messages via Telegram webhook, routes them to the linked agent
 * via buildAgent().invoke(), and replies in the same forum topic.
 * Also exports sendToTelegram() for proactive announcement delivery.
 */

import { timingSafeEqual } from "node:crypto";
import { Bot, type Context } from "grammy";
import type { Update } from "grammy/types";
import {
  getChannelByExternalId,
  getAgentById,
  getAgentByName,
  refreshSettings,
} from "@edda/db";
import type { Agent } from "@edda/db";
import { buildAgent, resolveThreadId } from "../agent/build-agent.js";
import { resolveRetrievalContext } from "../agent/tool-helpers.js";
import { withTimeout } from "../utils/with-timeout.js";
import { registerSender } from "./deliver.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TELEGRAM_MAX_LENGTH = 4096;

let bot: Bot | null = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initTelegram(token: string): Bot {
  bot = new Bot(token);

  bot.on("message:text", (ctx) => handleTextMessage(ctx));

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Edda Telegram bridge active. Messages in linked topics are routed to agents.\n\n" +
        "Use /status to see which agent is linked to this topic.",
    );
  });

  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    const threadId = ctx.message?.message_thread_id;
    const externalId = threadId ? `${chatId}:${threadId}` : `${chatId}:dm`;

    const channel = await getChannelByExternalId("telegram", externalId);
    if (channel) {
      await ctx.reply(`Linked to agent. Channel ID: ${channel.id}`);
    } else {
      await ctx.reply("This topic is not linked to any agent.");
    }
  });

  // Register the sender for proactive delivery
  registerSender({
    platform: "telegram",
    send: sendToTelegram,
  });

  console.log("  Telegram bot initialized");
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
  console.log(`  Telegram webhook: ${info.url} (pending: ${info.pending_update_count})`);
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
  if (!expected) return true;
  if (!headerValue) return false;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(headerValue);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
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
      const settings = await refreshSettings();
      agentDef = await getAgentByName(settings.default_agent);
    }

    if (!agentDef) {
      await ctx.reply("This topic isn't linked to an agent.");
      return;
    }
  }

  // Send typing indicator and refresh it every 4s
  const typingInterval = setInterval(() => {
    ctx.api
      .sendChatAction(chatId, "typing", {
        message_thread_id: threadId,
      })
      .catch(() => {}); // best-effort
  }, 4000);

  try {
    await ctx.api.sendChatAction(chatId, "typing", {
      message_thread_id: threadId,
    });

    const agent = await buildAgent(agentDef);
    const agentThreadId = resolveThreadId(agentDef, {
      platform: "telegram",
      external_id: externalId,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await withTimeout(
      agent.invoke(
        { messages: [{ role: "user", content: text }] },
        {
          configurable: {
            thread_id: agentThreadId,
            agent_name: agentDef.name,
            retrieval_context: resolveRetrievalContext(agentDef.metadata, agentDef.name),
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
  } catch (err) {
    console.error(`[telegram] Agent invocation failed:`, err);
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

  const [chatIdStr, threadIdStr] = externalId.split(":");
  const chatId = Number(chatIdStr);
  const threadId = threadIdStr === "dm" ? undefined : Number(threadIdStr);

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

function extractLastAssistantMessage(result: {
  messages?: Array<{ role?: string; content?: unknown; _getType?: () => string }>;
}): string | undefined {
  const messages = result?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if ((m.role === "assistant" || m._getType?.() === "ai") && typeof m.content === "string") {
      return m.content;
    }
  }
  return undefined;
}

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

export function getTelegramBot(): Bot | null {
  return bot;
}
