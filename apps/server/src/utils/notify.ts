/**
 * Notification service — writes notification rows and optionally triggers agent runs.
 *
 * Replaces the old stub that wrote to the items table. Notifications are now
 * first-class entities with their own table, per-schedule configuration,
 * and support for inbox + agent targets (passive and active).
 */

import {
  createNotification,
  claimUnreadNotifications,
  getAgentByName,
  getChannelsByAgent,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import { buildAgent, resolveThreadId } from "../agent/build-agent.js";
import { resolveRetrievalContext } from "../agent/tool-helpers.js";
import { deliverToChannel } from "../channels/deliver.js";
import { runWithConcurrencyLimit } from "./semaphore.js";
import { sanitizeError } from "./sanitize-error.js";
import { withTimeout } from "./with-timeout.js";
import { getLogger } from "../logger.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface NotifyParams {
  sourceType: "schedule" | "agent" | "system";
  sourceId: string;
  targets: string[];
  summary: string;
  detail?: Record<string, unknown>;
  priority?: "low" | "normal" | "high";
  expiresAfter?: string | null;
}

/**
 * Write notification rows for each target and trigger active agent runs.
 * If `targets` is empty, this is a no-op.
 */
export async function notify(params: NotifyParams): Promise<void> {
  const { sourceType, sourceId, targets, summary, detail, priority, expiresAfter } = params;
  if (targets.length === 0) return;

  for (const target of targets) {
    const parsed = parseTarget(target);

    // announce targets bypass notification rows — direct channel delivery
    if (parsed.announce && parsed.targetId) {
      announceToChannels(parsed.targetId, summary).catch((err) => {
        getLogger().error({ agent: parsed.targetId, err }, "Announce delivery failed");
      });
      continue;
    }

    await createNotification({
      source_type: sourceType,
      source_id: sourceId,
      target_type: parsed.targetType,
      target_id: parsed.targetId,
      summary,
      detail,
      priority,
      expires_after: expiresAfter,
    });

    if (parsed.active && parsed.targetId) {
      triggerAgentRun(parsed.targetId).catch((err) => {
        getLogger().error({ agent: parsed.targetId, err }, "Failed to trigger active run");
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Target parsing
// ---------------------------------------------------------------------------

interface ParsedTarget {
  targetType: "inbox" | "agent";
  targetId: string | null;
  active: boolean;
  announce: boolean;
}

/**
 * Parse a notify target string into structured form.
 *
 * Formats:
 *   'inbox'                → { targetType: 'inbox', targetId: null, active: false, announce: false }
 *   'agent:<name>'         → { targetType: 'agent', targetId: '<name>', active: false, announce: false }
 *   'agent:<name>:active'  → { targetType: 'agent', targetId: '<name>', active: true, announce: false }
 *   'announce:<name>'      → { targetType: 'agent', targetId: '<name>', active: false, announce: true }
 */
function parseTarget(target: string): ParsedTarget {
  if (target === "inbox") {
    return { targetType: "inbox", targetId: null, active: false, announce: false };
  }

  if (target.startsWith("announce:")) {
    const agentName = target.slice("announce:".length);
    if (!agentName || !/^[a-z0-9_-]+$/i.test(agentName)) {
      getLogger().warn({ target }, "Invalid agent name in announce target, skipping");
      return { targetType: "inbox", targetId: null, active: false, announce: false };
    }
    return { targetType: "agent", targetId: agentName, active: false, announce: true };
  }

  if (target.startsWith("agent:")) {
    const parts = target.split(":");
    const agentName = parts[1];
    if (!agentName || !/^[a-z0-9_-]+$/i.test(agentName)) {
      getLogger().warn({ target }, "Invalid agent name in target, falling back to inbox");
      return { targetType: "inbox", targetId: null, active: false, announce: false };
    }
    const active = parts[2] === "active";
    return { targetType: "agent", targetId: agentName, active, announce: false };
  }

  throw new Error(`Unknown notification target format: '${target}'. Valid formats: 'inbox', 'agent:<name>', 'agent:<name>:active', 'announce:<name>'`);
}

// ---------------------------------------------------------------------------
// Active agent triggering
// ---------------------------------------------------------------------------

/**
 * Announce pass-through: push source output directly to an agent's
 * receive_announcements channels. No agent invocation — zero cost, instant.
 */
async function announceToChannels(agentName: string, text: string): Promise<void> {
  const log = getLogger();
  const definition = await getAgentByName(agentName);
  if (!definition) {
    log.warn({ agent: agentName }, "Announce target agent not found, skipping");
    return;
  }

  const channels = await getChannelsByAgent(definition.id, { receiveAnnouncements: true });
  if (channels.length === 0) return;

  log.info({ agent: agentName, channels: channels.length }, "Announcing to channels");
  for (const channel of channels) {
    try {
      await deliverToChannel(channel, text);
    } catch (err) {
      log.error({ platform: channel.platform, externalId: channel.external_id, err }, "Announce delivery to channel failed");
    }
  }
}

// ---------------------------------------------------------------------------
// Post-run delivery: channels + notify targets
// ---------------------------------------------------------------------------

export interface DeliverRunResultsParams {
  agentId: string;
  agentName: string;
  runId: string;
  lastMessage: string | undefined;
  targets: string[];
  sourceType: "schedule" | "agent" | "system";
  sourceId: string;
  error?: unknown;
  /** Extra fields merged into notification detail */
  detail?: Record<string, unknown>;
  expiresAfter?: string | null;
}

/**
 * Shared post-run delivery: announce to channels, then notify targets.
 * Handles both success (lastMessage set, no error) and failure (error set) cases.
 * All errors are caught and logged — this never throws.
 */
export async function deliverRunResults(params: DeliverRunResultsParams): Promise<void> {
  const {
    agentId,
    agentName,
    runId,
    lastMessage,
    targets,
    sourceType,
    sourceId,
    error,
    detail,
    expiresAfter,
  } = params;
  const log = getLogger();

  if (error) {
    // Failure path — notify targets about the error
    if (targets.length > 0) {
      try {
        await notify({
          sourceType,
          sourceId,
          targets,
          summary: `${agentName} failed: ${sanitizeError(error).slice(0, 150)}`,
          detail: { run_id: runId, agent_name: agentName, ...detail },
          priority: "high",
          expiresAfter,
        });
      } catch (notifyErr) {
        log.error({ agent: agentName, err: notifyErr }, "Failure notification failed");
      }
    }
    return;
  }

  // Success path — deliver to channels, then notify targets
  if (lastMessage) {
    await deliverToAnnouncementChannels(agentId, agentName, lastMessage);
  }

  // Filter out announce: targets — channel delivery is already handled above
  const filteredTargets = targets.filter((t) => !t.startsWith("announce:"));
  if (filteredTargets.length > 0) {
    try {
      await notify({
        sourceType,
        sourceId,
        targets: filteredTargets,
        summary: lastMessage ?? `${agentName} completed`,
        detail: { run_id: runId, agent_name: agentName, ...detail },
        expiresAfter,
      });
    } catch (notifyErr) {
      log.error({ agent: agentName, err: notifyErr }, "Notification failed");
    }
  }
}

/**
 * Deliver an agent's response to its announcement channels after a triggered run.
 */
async function deliverToAnnouncementChannels(agentId: string, agentName: string, text: string): Promise<void> {
  const log = getLogger();
  try {
    const channels = await getChannelsByAgent(agentId, { receiveAnnouncements: true });
    if (channels.length === 0) return;

    log.info({ agent: agentName, channels: channels.length }, "Delivering to announcement channels");
    for (const channel of channels) {
      try {
        await deliverToChannel(channel, text);
      } catch (err) {
        log.error({ agent: agentName, platform: channel.platform, externalId: channel.external_id, err }, "Channel delivery failed");
      }
    }
  } catch (err) {
    log.error({ agent: agentName, err }, "Failed to query announcement channels");
  }
}

/**
 * Trigger an immediate agent run with claimed notification content as the user message.
 * Uses atomic claim to prevent duplicate runs from concurrent notifications.
 */
async function triggerAgentRun(agentName: string): Promise<void> {
  const log = getLogger();
  const definition = await getAgentByName(agentName);
  if (!definition?.enabled) return;

  // Atomically claim all unread notifications for this agent.
  // If another concurrent call already claimed them, this returns [].
  const claimed = await claimUnreadNotifications(agentName);
  if (claimed.length === 0) return;

  const message = claimed
    .map((n) => `[notification from ${n.source_id}]\n${n.summary}`)
    .join("\n\n");

  const threadId = resolveThreadId(definition);
  const run = await createTaskRun({
    agent_id: definition.id,
    agent_name: agentName,
    trigger: "notification",
    thread_id: threadId,
  });

  const settings = await refreshSettings();
  setImmediate(() => {
    runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
      const startTime = Date.now();
      try {
        await startTaskRun(run.id);
        log.info({ agent: agentName, runId: run.id, notifications: claimed.length }, "Triggered active run");
        const agent = await buildAgent(definition);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await withTimeout(
          agent.invoke(
            { messages: [{ role: "user", content: message }] },
            {
              configurable: {
                thread_id: threadId,
                agent_name: agentName,
                retrieval_context: resolveRetrievalContext(definition.metadata, agentName),
              },
            },
          ),
          AGENT_TIMEOUT_MS,
          agentName,
        );
        const lastMsg = result?.messages?.[result.messages.length - 1]?.content;
        const fullResponse = typeof lastMsg === "string" ? lastMsg : undefined;
        await completeTaskRun(run.id, {
          output_summary: fullResponse?.slice(0, 500),
          duration_ms: Date.now() - startTime,
        });

        // Deliver full agent response to announcement channels
        if (fullResponse) {
          await deliverToAnnouncementChannels(definition.id, agentName, fullResponse);
        }
      } catch (err) {
        log.error({ agent: agentName, runId: run.id, err }, "Active run failed");
        await failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
          log.error({ runId: run.id, err: dbErr }, "Failed to record failure");
        });
      }
    }).catch((err) => {
      log.error({ agent: agentName, err }, "Concurrency/setup failure");
      failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
        log.error({ runId: run.id, err: dbErr }, "Failed to record failure");
      });
    });
  });
}
