/**
 * Stream an agent response and deliver via adapter progressive updates.
 *
 * Uses adapter.sendInitial() + adapter.editMessage() if available,
 * falls back to collecting full response and calling adapter.send().
 */

import type { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";
import { getLogger } from "../logger.js";
import { withTimeout } from "../utils/with-timeout.js";
import type { ChannelAdapter, MessageHandle } from "../channels/adapter.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const EDIT_DEBOUNCE_MS = 1000; // max 1 edit per second
const MIN_CHUNK_CHARS = 50; // minimum chars accumulated before triggering an edit

/**
 * Extract text content from a streamEvents chunk, normalizing Anthropic's
 * array-of-content-blocks format into a plain string.
 */
function extractChunkContent(chunk: Record<string, unknown>): string {
  const content = chunk.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let text = "";
    for (const block of content) {
      if (typeof block === "string") text += block;
      else if (block?.type === "text" && block.text) text += block.text;
      else if (block?.type === "text_delta" && block.text) text += block.text;
    }
    return text;
  }
  return "";
}

export async function streamToAdapter(opts: {
  agent: Runnable;
  input: string;
  config: RunnableConfig;
  adapter: ChannelAdapter;
  externalId: string;
  timeoutMs?: number;
}): Promise<string | undefined> {
  const { agent, input, config, adapter, externalId } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = getLogger();

  const canStream = Boolean(adapter.sendInitial && adapter.editMessage);
  const maxLen = adapter.maxMessageLength ?? 4096;

  // Accumulates the full response text
  let fullText = "";

  // Streaming state (only used when adapter supports progressive updates)
  let handle: MessageHandle | null = null;
  let lastEditTime = 0;
  let pendingEdit = false;
  let editTimer: ReturnType<typeof setTimeout> | null = null;

  // Typing indicator — start before streaming, clear on first chunk
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  let typingCleared = false;

  if (adapter.sendTypingIndicator) {
    adapter.sendTypingIndicator(externalId).catch((err: unknown) => {
      log.warn({ err, platform: adapter.platform }, "Typing indicator failed");
    });

    let typingFailLogged = false;
    typingInterval = setInterval(() => {
      if (typingCleared) return;
      adapter.sendTypingIndicator!(externalId).catch((err: unknown) => {
        if (!typingFailLogged) {
          typingFailLogged = true;
          log.warn({ err, platform: adapter.platform }, "Typing indicator failed");
        }
      });
    }, 4000);
  }

  function clearTyping() {
    if (!typingCleared) {
      typingCleared = true;
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }
    }
  }

  /**
   * Flush accumulated text to the adapter via edit. If the text exceeds the
   * platform's max message length, send the overflow as new messages.
   */
  async function flushEdit(): Promise<void> {
    if (!handle || !adapter.editMessage) return;

    pendingEdit = false;
    lastEditTime = Date.now();

    // If text fits in one message, just edit in place
    if (fullText.length <= maxLen) {
      try {
        await adapter.editMessage(handle, fullText);
      } catch (err) {
        log.warn({ err, platform: adapter.platform }, "Edit message failed — will send remainder at end");
      }
      return;
    }

    // Text exceeds max — edit current message to capacity, send overflow as new messages
    try {
      await adapter.editMessage(handle, fullText.slice(0, maxLen));
    } catch (err) {
      log.warn({ err, platform: adapter.platform }, "Edit message failed during overflow");
    }
    // Overflow will be sent as new messages in the finalize step
  }

  function scheduleEdit(): void {
    if (!canStream || pendingEdit) return;

    const elapsed = Date.now() - lastEditTime;
    if (elapsed >= EDIT_DEBOUNCE_MS) {
      pendingEdit = true;
      flushEdit().catch((err) => {
        log.warn({ err, platform: adapter.platform }, "Scheduled edit failed");
      });
    } else {
      pendingEdit = true;
      editTimer = setTimeout(() => {
        flushEdit().catch((err) => {
          log.warn({ err, platform: adapter.platform }, "Debounced edit failed");
        });
      }, EDIT_DEBOUNCE_MS - elapsed);
    }
  }

  const streamPromise = (async () => {
    const stream = agent.streamEvents(
      { messages: [new HumanMessage(input)] },
      { ...config, version: "v2" },
    );

    for await (const event of stream) {
      if (event.event !== "on_chat_model_stream") continue;

      const chunk = event.data?.chunk;
      if (!chunk) continue;

      const content = extractChunkContent(chunk as Record<string, unknown>);
      if (!content) continue;

      fullText += content;

      if (!canStream) continue;

      // First chunk — send initial message and clear typing
      if (!handle) {
        if (fullText.length < MIN_CHUNK_CHARS) continue;

        clearTyping();
        try {
          handle = await adapter.sendInitial!(externalId, fullText);
          lastEditTime = Date.now();
        } catch (err) {
          log.warn({ err, platform: adapter.platform }, "sendInitial failed — falling back to send()");
          // Fall back to non-streaming: collect full text and send at end
          handle = null;
          break;
        }
        continue;
      }

      // Subsequent chunks — debounced edits
      const sinceLast = fullText.length - (handle ? fullText.length - content.length : 0);
      if (sinceLast >= MIN_CHUNK_CHARS || fullText.length >= maxLen) {
        scheduleEdit();
      }
    }
  })();

  try {
    await withTimeout(streamPromise, timeoutMs, `${adapter.platform} stream`);
  } finally {
    clearTyping();
    if (editTimer) clearTimeout(editTimer);
  }

  if (!fullText) return undefined;

  // Finalize: ensure the complete text is delivered
  if (canStream && handle) {
    // Final edit with complete text
    if (fullText.length <= maxLen) {
      try {
        await adapter.editMessage!(handle, fullText);
      } catch (err) {
        log.warn({ err, platform: adapter.platform }, "Final edit failed");
      }
    } else {
      // Edit first message to max, send overflow as new messages
      try {
        await adapter.editMessage!(handle, fullText.slice(0, maxLen));
      } catch (err) {
        log.warn({ err, platform: adapter.platform }, "Final edit failed during overflow");
      }
      // Send remaining text as new message(s)
      let remaining = fullText.slice(maxLen);
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, maxLen);
        remaining = remaining.slice(maxLen);
        await adapter.send(externalId, chunk);
      }
    }
  } else {
    // No streaming support or sendInitial failed — send complete response
    await adapter.send(externalId, fullText);
  }

  return fullText;
}
