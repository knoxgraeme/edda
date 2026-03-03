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
import { stripReasoningContent } from "../utils/strip-reasoning.js";
import type { ChannelAdapter, MessageHandle } from "../channels/adapter.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const EDIT_DEBOUNCE_MS = 1000; // max 1 edit per second
const MIN_CHUNK_CHARS = 50; // minimum chars accumulated before triggering an edit
const MAX_RESPONSE_BYTES = 100 * 1024; // 100 KB — prevent unbounded accumulation

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

  let canStream = Boolean(adapter.sendInitial && adapter.editMessage);
  const maxLen = adapter.maxMessageLength ?? 4096;

  // Accumulates the full response text
  let fullText = "";

  // Streaming state (only used when adapter supports progressive updates)
  let handle: MessageHandle | null = null;
  let lastEditTime = 0;
  let pendingEdit = false;
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let charsSinceLastEdit = 0;

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

  /** Flush accumulated text to the adapter via edit (capped to maxLen). */
  async function flushEdit(): Promise<void> {
    if (!handle || !adapter.editMessage) return;

    lastEditTime = Date.now();
    charsSinceLastEdit = 0;

    try {
      await adapter.editMessage(handle, fullText.slice(0, maxLen));
    } catch (err) {
      log.error({ err, platform: adapter.platform }, "Edit message failed");
    } finally {
      pendingEdit = false;
    }
  }

  function scheduleEdit(): void {
    if (!canStream || pendingEdit) return;

    const elapsed = Date.now() - lastEditTime;
    if (elapsed >= EDIT_DEBOUNCE_MS) {
      pendingEdit = true;
      flushEdit().catch((err) => {
        log.error({ err, platform: adapter.platform }, "Scheduled edit failed");
      });
    } else {
      pendingEdit = true;
      editTimer = setTimeout(() => {
        flushEdit().catch((err) => {
          log.error({ err, platform: adapter.platform }, "Debounced edit failed");
        });
      }, EDIT_DEBOUNCE_MS - elapsed);
    }
  }

  const abortController = new AbortController();

  const streamPromise = (async () => {
    const stream = agent.streamEvents(
      { messages: [new HumanMessage(input)] },
      { ...config, signal: abortController.signal, version: "v2" },
    );

    let insideThinkBlock = false;

    for await (const event of stream) {
      if (event.event !== "on_chat_model_stream") continue;

      const chunk = event.data?.chunk;
      if (!chunk) continue;

      let content = extractChunkContent(chunk as Record<string, unknown>);
      if (!content) continue;

      // Strip reasoning blocks (e.g. <think>...</think> from Minimax, DeepSeek)
      ({ content, insideThinkBlock } = stripReasoningContent(content, insideThinkBlock));
      if (!content) continue;

      fullText += content;

      // Cap response size to prevent unbounded accumulation
      if (fullText.length > MAX_RESPONSE_BYTES) {
        fullText = fullText.slice(0, MAX_RESPONSE_BYTES);
        log.warn({ platform: adapter.platform }, "Response truncated at max length");
        break;
      }

      if (!canStream) continue;

      // First chunk — send initial message and clear typing
      if (!handle) {
        if (fullText.length < MIN_CHUNK_CHARS) continue;

        clearTyping();
        try {
          handle = await adapter.sendInitial!(externalId, fullText);
          lastEditTime = Date.now();
          charsSinceLastEdit = 0;
        } catch (err) {
          log.error({ err, platform: adapter.platform }, "sendInitial failed — falling back to send()");
          // Don't break — continue consuming stream so fullText is complete.
          // The finalize block will send via adapter.send() since handle is null.
          canStream = false;
        }
        continue;
      }

      // Subsequent chunks — debounced edits
      charsSinceLastEdit += content.length;
      if (charsSinceLastEdit >= MIN_CHUNK_CHARS) {
        scheduleEdit();
      }
    }
  })();

  try {
    await withTimeout(streamPromise, timeoutMs, `${adapter.platform} stream`);
  } catch (err) {
    // If we already sent an initial message, edit it to show error state
    if (handle && adapter.editMessage) {
      const errorText = fullText
        ? fullText.slice(0, maxLen - 50) + "\n\n[Response interrupted]"
        : "Sorry, something went wrong.";
      await adapter.editMessage(handle, errorText).catch(() => {});
    }
    throw err;
  } finally {
    abortController.abort();
    clearTyping();
    if (editTimer) clearTimeout(editTimer);
  }

  if (!fullText) {
    log.warn({ platform: adapter.platform, externalId }, "Agent produced no text response");
    return undefined;
  }

  // Finalize: ensure the complete text is delivered
  if (canStream && handle) {
    // Final edit — then send overflow as new messages if needed
    await flushEdit();
    if (fullText.length > maxLen) {
      // Delegate overflow to adapter.send() which handles word-boundary splitting
      await adapter.send(externalId, fullText.slice(maxLen));
    }
  } else if (canStream && !handle) {
    // sendInitial failed — edit the partial message if possible, then send full via send()
    await adapter.send(externalId, fullText);
  } else {
    // No streaming support — send complete response
    await adapter.send(externalId, fullText);
  }

  return fullText;
}
