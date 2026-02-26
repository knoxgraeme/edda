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
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import { buildAgent, resolveThreadId } from "../agent/build-agent.js";
import { resolveRetrievalContext } from "../agent/tool-helpers.js";
import { runWithConcurrencyLimit } from "./semaphore.js";
import { sanitizeError } from "./sanitize-error.js";
import { withTimeout } from "./with-timeout.js";

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
  expiresAfter?: string;
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
        console.error(`[notify] Failed to trigger active run for ${parsed.targetId}:`, err);
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
}

/**
 * Parse a notify target string into structured form.
 *
 * Formats:
 *   'inbox'              → { targetType: 'inbox', targetId: null, active: false }
 *   'agent:<name>'       → { targetType: 'agent', targetId: '<name>', active: false }
 *   'agent:<name>:active' → { targetType: 'agent', targetId: '<name>', active: true }
 */
function parseTarget(target: string): ParsedTarget {
  if (target === "inbox") {
    return { targetType: "inbox", targetId: null, active: false };
  }

  if (target.startsWith("agent:")) {
    const parts = target.split(":");
    const agentName = parts[1];
    const active = parts[2] === "active";
    return { targetType: "agent", targetId: agentName, active };
  }

  console.warn(`[notify] Unknown target format: ${target}, treating as inbox`);
  return { targetType: "inbox", targetId: null, active: false };
}

// ---------------------------------------------------------------------------
// Active agent triggering
// ---------------------------------------------------------------------------

/**
 * Trigger an immediate agent run with claimed notification content as the user message.
 * Uses atomic claim to prevent duplicate runs from concurrent notifications.
 */
async function triggerAgentRun(agentName: string): Promise<void> {
  const definition = await getAgentByName(agentName);
  if (!definition?.enabled) return;

  // Atomically claim all unread notifications for this agent.
  // If another concurrent call already claimed them, this returns [].
  const claimed = await claimUnreadNotifications(agentName);
  if (claimed.length === 0) return;

  const message = claimed
    .map((n) => {
      const runId = (n.detail as Record<string, unknown>)?.run_id;
      const header = `[notification from ${n.source_id}${runId ? ` | run_id: ${runId}` : ""}]`;
      return `${header} ${n.summary}`;
    })
    .join("\n");

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
        console.log(`[notify] Triggered active run for ${agentName} (${claimed.length} notification(s))`);
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
        await completeTaskRun(run.id, {
          output_summary: typeof lastMsg === "string" ? lastMsg.slice(0, 500) : undefined,
          duration_ms: Date.now() - startTime,
        });
      } catch (err) {
        console.error(`[notify] Active run for ${agentName} failed:`, err);
        await failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
          console.error(`[notify] Failed to record failure for ${run.id}:`, dbErr);
        });
      }
    }).catch((err) => {
      console.error(`[notify] Concurrency/setup failure for ${agentName}:`, err);
      failTaskRun(run.id, sanitizeError(err)).catch((dbErr) => {
        console.error(`[notify] Failed to record failure for ${run.id}:`, dbErr);
      });
    });
  });
}
