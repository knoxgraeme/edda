/**
 * Platform-agnostic inbound message handler.
 *
 * Called by adapters after they've parsed the webhook and checked auth.
 * Owns: channel->agent resolution, thread management, agent execution,
 *       tracing, error handling, and response delivery.
 */

import {
  getChannelByExternalId,
  getAgentById,
  getAgentByName,
  getSettings,
} from "@edda/db";
import type { Agent } from "@edda/db";
import { resolveThreadId } from "../agent/build-agent.js";
import { getOrBuildAgent } from "../agent/agent-cache.js";
import { extractLastAssistantMessage } from "../agent/tool-helpers.js";
import { withTimeout } from "../utils/with-timeout.js";
import { getLogger, withTraceId } from "../logger.js";
import type { ChannelAdapter, ParsedMessage } from "./adapter.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function handleInboundMessage(opts: {
  parsed: ParsedMessage;
  adapter: ChannelAdapter;
  fallbackAgentName?: string;
}): Promise<void> {
  const { parsed, adapter } = opts;
  const log = getLogger();

  // 1. Resolve channel -> agent
  const channel = await getChannelByExternalId(adapter.platform, parsed.externalId);
  let agentDef: Agent | null = null;

  if (channel) {
    const found = await getAgentById(channel.agent_id);
    if (found?.enabled) {
      agentDef = found;
    }
  }

  if (!agentDef) {
    if (channel) {
      // Channel exists but agent is disabled/missing
      await adapter.send(parsed.externalId, "The agent linked to this channel is currently unavailable.");
      return;
    }

    // No channel row — try fallback agent
    if (opts.fallbackAgentName) {
      const fallback = await getAgentByName(opts.fallbackAgentName);
      if (fallback?.enabled) {
        agentDef = fallback;
      }
    }

    if (!agentDef) {
      await adapter.send(parsed.externalId, "This channel isn't linked to an agent.");
      return;
    }
  }

  // 2. Build agent (cached) + resolve thread
  const state = await getOrBuildAgent(agentDef.name);
  if (!state) {
    await adapter.send(parsed.externalId, "The agent is currently unavailable.");
    return;
  }

  const settings = await getSettings();
  const threadId = resolveThreadId(
    agentDef,
    { platform: adapter.platform, external_id: parsed.externalId },
    { timezone: settings.user_timezone },
  );

  // 3. Execute with tracing + error handling
  await withTraceId({ module: adapter.platform, agent: agentDef.name }, async () => {
    // Start typing indicator
    if (adapter.sendTypingIndicator) {
      adapter.sendTypingIndicator(parsed.externalId, parsed.replyContext).catch((err: unknown) => {
        log.warn({ err, platform: adapter.platform }, "Typing indicator failed");
      });
    }

    // Typing interval — refresh every 4 seconds
    let typingFailLogged = false;
    const typingInterval = adapter.sendTypingIndicator
      ? setInterval(() => {
          adapter.sendTypingIndicator!(parsed.externalId, parsed.replyContext).catch((err: unknown) => {
            if (!typingFailLogged) {
              typingFailLogged = true;
              log.warn({ err, platform: adapter.platform }, "Typing indicator failed");
            }
          });
        }, 4000)
      : null;

    try {
      // Phase 3 will add streaming support here (streamToAdapter).
      // For now, use invoke() and send the full response.
      const result: { messages?: Array<{ role?: string; content?: unknown; _getType?: () => string }> } =
        await withTimeout(
          state.agent.invoke(
            { messages: [{ role: "user", content: parsed.text }] },
            {
              configurable: {
                thread_id: threadId,
                agent_name: agentDef.name,
                retrieval_context: state.retrievalContext,
              },
            },
          ),
          AGENT_TIMEOUT_MS,
          agentDef.name,
        );

      const reply = extractLastAssistantMessage(result);
      if (reply) {
        await adapter.send(parsed.externalId, reply);
      }
    } catch (err) {
      log.error({ err, agent: agentDef.name, platform: adapter.platform }, "Channel agent invocation failed");
      await adapter.send(parsed.externalId, "Sorry, something went wrong.");
    } finally {
      if (typingInterval) clearInterval(typingInterval);
    }
  });
}
