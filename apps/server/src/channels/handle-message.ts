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
import { streamToAdapter } from "../agent/stream-to-adapter.js";
import { getLogger, withTraceId } from "../logger.js";
import type { ChannelAdapter, ParsedMessage } from "./adapter.js";

export async function handleInboundMessage(opts: {
  parsed: ParsedMessage;
  adapter: ChannelAdapter;
  useFallbackAgent?: boolean;
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
    if (opts.useFallbackAgent) {
      const settings = await getSettings();
      const fallback = await getAgentByName(settings.default_agent);
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

  const { user_timezone } = await getSettings();
  const threadId = resolveThreadId(
    agentDef,
    { platform: adapter.platform, external_id: parsed.externalId },
    { timezone: user_timezone },
  );

  // 3. Stream agent response with tracing + error handling
  await withTraceId({ module: adapter.platform, agent: agentDef.name }, async () => {
    try {
      await streamToAdapter({
        agent: state.agent,
        input: parsed.text,
        config: {
          configurable: {
            thread_id: threadId,
            agent_name: agentDef.name,
            retrieval_context: state.retrievalContext,
          },
        },
        adapter,
        externalId: parsed.externalId,
      });
    } catch (err) {
      log.error({ err, agent: agentDef.name, platform: adapter.platform }, "Channel agent streaming failed");
      try {
        await adapter.send(parsed.externalId, "Sorry, something went wrong.");
      } catch (sendErr) {
        log.error({ err: sendErr, platform: adapter.platform }, "Failed to send error message to user");
      }
    }
  });
}
