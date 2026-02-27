/**
 * Local cron runner — uses node-cron for scheduling
 *
 * Reads agent_schedules table to register per-schedule cron tasks. Each
 * execution creates a task_run record for observability. The cron runner
 * is generic — it just invokes agents with their schedule prompt.
 */

import cron from "node-cron";

import {
  getEnabledSchedules,
  getScheduleById,
  getAgentByName,
  getChannelsByAgent,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
  getUnreadNotifications,
  markNotificationsRead,
  deleteExpiredNotifications,
  claimDueReminders,
  advanceReminderByDate,
  advanceReminderByInterval,
  completeReminder,
  resetStuckSendingReminders,
} from "@edda/db";
import type { Notification } from "@edda/db";
import type { EnabledSchedule } from "@edda/db";
import { sanitizeError } from "../utils/sanitize-error.js";
import { withTimeout } from "../utils/with-timeout.js";
import { detectRecurrenceFormat, getNextCronDate } from "../utils/reminder-recurrence.js";

import { buildAgent, resolveThreadId, MODEL_SETTINGS_KEYS } from "../agent/build-agent.js";
import { resolveRetrievalContext } from "../agent/tool-helpers.js";
import { runWithConcurrencyLimit } from "../utils/semaphore.js";
import { notify } from "../utils/notify.js";
import { deliverToChannel } from "../channels/deliver.js";
import type { CronRunner } from "./index.js";

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SCHEDULE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REMINDER_POLL_INTERVAL_MS = 60 * 1000; // 1 minute

// ---------------------------------------------------------------------------
// LocalCronRunner class
// ---------------------------------------------------------------------------

export class LocalCronRunner implements CronRunner {
  /** Keyed by schedule ID */
  private _registered = new Map<string, { task: cron.ScheduledTask; cron: string }>();
  private _syncInterval: NodeJS.Timeout | null = null;
  private _reminderInterval: NodeJS.Timeout | null = null;
  private _running = false;
  private _reminderPolling = false;
  private syncFailures = 0;

  async start(): Promise<void> {
    if (this._running) {
      console.warn("  [cron] Standalone cron runner is already running");
      return;
    }
    this._running = true;

    await refreshSettings();
    const schedules = await getEnabledSchedules();

    for (const schedule of schedules) {
      this.registerSchedule(schedule);
    }

    this._syncInterval = setInterval(() => this.syncSchedules(), SCHEDULE_SYNC_INTERVAL_MS);

    // Reminder poller: recover stuck rows, then poll every minute
    try {
      const reset = await resetStuckSendingReminders();
      if (reset > 0) console.log(`  [reminders] Reset ${reset} stuck sending reminder(s)`);
    } catch (err) {
      console.warn("[reminders] Failed to reset stuck reminders:", err);
    }
    this._reminderInterval = setInterval(() => this.pollReminders(), REMINDER_POLL_INTERVAL_MS);

    console.log(`  Standalone cron runner started (${this._registered.size} schedule(s))`);
  }

  async stop(): Promise<void> {
    if (!this._running) return;

    for (const entry of this._registered.values()) {
      entry.task.stop();
    }
    this._registered.clear();

    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }

    if (this._reminderInterval) {
      clearInterval(this._reminderInterval);
      this._reminderInterval = null;
    }

    this._running = false;
    console.log("  Standalone cron runner stopped");
  }

  // ── Schedule registration ──────────────────────────────────────

  private registerSchedule(schedule: EnabledSchedule): void {
    if (!cron.validate(schedule.cron)) {
      console.warn(
        `  [cron] Skipping ${schedule.agent_name}/${schedule.name} — invalid cron: ${schedule.cron}`,
      );
      return;
    }

    const existing = this._registered.get(schedule.id);
    if (existing && existing.cron === schedule.cron) return;

    if (existing) {
      existing.task.stop();
      console.log(
        `  [cron] Schedule changed for ${schedule.agent_name}/${schedule.name}: ${existing.cron} → ${schedule.cron}`,
      );
    }

    const task = cron.schedule(schedule.cron, () =>
      this.executeSchedule(schedule.id, schedule.agent_name),
    );
    this._registered.set(schedule.id, { task, cron: schedule.cron });
    console.log(
      `  [cron] Registered: ${schedule.agent_name}/${schedule.name} (${schedule.cron})`,
    );
  }

  private async syncSchedules(): Promise<void> {
    try {
      const current = await getEnabledSchedules();
      const currentIds = new Set(current.map((s) => s.id));

      for (const schedule of current) {
        this.registerSchedule(schedule);
      }

      for (const [id, entry] of this._registered) {
        if (!currentIds.has(id)) {
          entry.task.stop();
          this._registered.delete(id);
          console.log(`  [cron] Unregistered schedule: ${id}`);
        }
      }

      try {
        const deleted = await deleteExpiredNotifications();
        if (deleted > 0) console.log(`  [cron] Cleaned up ${deleted} expired notification(s)`);
      } catch (cleanupErr) {
        console.warn("[cron] Failed to clean expired notifications:", cleanupErr);
      }

      try {
        const reset = await resetStuckSendingReminders();
        if (reset > 0) console.log(`  [reminders] Reset ${reset} stuck sending reminder(s)`);
      } catch (err) {
        console.warn("[reminders] Failed to reset stuck reminders during sync:", err);
      }

      this.syncFailures = 0;
    } catch (err) {
      this.syncFailures++;
      const level = this.syncFailures >= 3 ? "error" : "warn";
      console[level](
        `[Cron] syncSchedules failed (${this.syncFailures} consecutive):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Reminder polling ───────────────────────────────────────────

  private async pollReminders(): Promise<void> {
    if (this._reminderPolling) return;
    this._reminderPolling = true;
    try {
      const due = await claimDueReminders();
      if (due.length === 0) return;

      console.log(`  [reminders] Firing ${due.length} due reminder(s)`);
      const CONCURRENCY = 10;
      for (let i = 0; i < due.length; i += CONCURRENCY) {
        const batch = due.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((r) => this.fireReminder(r)));
      }
    } catch (err) {
      console.error("[reminders] Poll failed:", err);
    } finally {
      this._reminderPolling = false;
    }
  }

  private async fireReminder(reminder: Notification): Promise<void> {
    const targets = reminder.targets.length > 0 ? reminder.targets : ["inbox"];

    try {
      await notify({
        sourceType: "system",
        sourceId: `reminder:${reminder.id}`,
        targets,
        summary: reminder.summary,
        detail: { reminder_id: reminder.id, ...reminder.detail },
        priority: reminder.priority,
      });
    } catch (err) {
      console.error(`[reminders] Failed to deliver reminder ${reminder.id}:`, err);
    }

    // Advance or complete
    if (reminder.recurrence) {
      try {
        const format = detectRecurrenceFormat(reminder.recurrence);
        if (format === "cron") {
          const nextAt = getNextCronDate(reminder.recurrence);
          await advanceReminderByDate(reminder.id, nextAt);
          console.log(`  [reminders] Advanced cron reminder ${reminder.id} → ${nextAt.toISOString()}`);
        } else {
          await advanceReminderByInterval(reminder.id, reminder.recurrence);
          console.log(`  [reminders] Advanced interval reminder ${reminder.id} by ${reminder.recurrence}`);
        }
      } catch (err) {
        console.error(`[reminders] Failed to advance reminder ${reminder.id}:`, err);
        // Complete it rather than leave it stuck in 'sending'
        await completeReminder(reminder.id).catch(() => {});
      }
    } else {
      await completeReminder(reminder.id);
    }
  }

  // ── Schedule execution ─────────────────────────────────────────

  private async executeSchedule(scheduleId: string, agentNameHint: string): Promise<void> {
    const freshSchedule = await getScheduleById(scheduleId);
    if (!freshSchedule || !freshSchedule.enabled) {
      console.log(`  [cron] Skipping schedule ${scheduleId} — not found or disabled`);
      return;
    }

    const freshDef = await getAgentByName(agentNameHint);
    if (!freshDef || !freshDef.enabled) {
      console.log(`  [cron] Skipping ${agentNameHint} — not found or disabled`);
      return;
    }

    const settings = await refreshSettings();
    const modelName =
      freshDef.model_settings_key && MODEL_SETTINGS_KEYS.has(freshDef.model_settings_key)
        ? ((settings as unknown as Record<string, unknown>)[
            freshDef.model_settings_key
          ] as string)
        : undefined;

    const contextAgent = freshSchedule.thread_lifetime
      ? { ...freshDef, thread_lifetime: freshSchedule.thread_lifetime }
      : freshDef;
    const threadId = resolveThreadId(contextAgent);

    const run = await createTaskRun({
      agent_id: freshDef.id,
      agent_name: freshDef.name,
      trigger: "cron",
      thread_id: threadId,
      schedule_id: freshSchedule.id,
      model: modelName,
    });

    await runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
      const startTime = Date.now();
      try {
        await startTaskRun(run.id);
        console.log(`  [cron] Executing: ${freshDef.name}/${freshSchedule.name}`);

        // Passive notification consumption: prepend unread notifications to the prompt
        let userMessage = freshSchedule.prompt;
        try {
          const pending = await getUnreadNotifications(freshDef.name);
          if (pending.length > 0) {
            const notificationLines = pending
              .map((n) => `[notification from ${n.source_id}]\n${n.summary}`)
              .join("\n\n");
            userMessage = `${notificationLines}\n---\n${userMessage}`;
            await markNotificationsRead(pending.map((n) => n.id));
          }
        } catch (notifyErr) {
          console.error(
            `  [cron] ${freshDef.name} failed to read pending notifications:`,
            notifyErr,
          );
        }

        const agent = await buildAgent(freshDef);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await withTimeout(
          agent.invoke(
            { messages: [{ role: "user", content: userMessage }] },
            {
              configurable: {
                thread_id: threadId,
                agent_name: freshDef.name,
                retrieval_context: resolveRetrievalContext(freshDef.metadata, freshDef.name),
              },
            },
          ),
          AGENT_TIMEOUT_MS,
          freshDef.name,
        );

        const duration = Date.now() - startTime;
        const lastMessage = extractLastAssistantMessage(result);
        await completeTaskRun(run.id, { output_summary: lastMessage?.slice(0, 500), duration_ms: duration });

        // Deliver to announcement channels
        if (lastMessage) {
          try {
            const channels = await getChannelsByAgent(freshDef.id, { receiveAnnouncements: true });
            for (const channel of channels) {
              await deliverToChannel(channel, lastMessage).catch((err) =>
                console.error(`  [cron] Channel delivery to ${channel.platform}/${channel.external_id} failed:`, err),
              );
            }
          } catch (err) {
            console.error(`  [cron] ${freshDef.name} channel delivery failed:`, err);
          }
        }

        if (freshSchedule.notify.length > 0) {
          try {
            await notify({
              sourceType: "schedule",
              sourceId: freshSchedule.id,
              targets: freshSchedule.notify,
              summary: lastMessage ?? `${freshDef.name} completed`,
              detail: { run_id: run.id, agent_name: freshDef.name, schedule_name: freshSchedule.name },
              expiresAfter: freshSchedule.notify_expires_after,
            });
          } catch (notifyErr) {
            console.error(
              `  [cron] ${freshDef.name} notification failed (run was successful):`,
              notifyErr,
            );
          }
        }

        console.log(`  [cron] ${freshDef.name}/${freshSchedule.name} completed in ${duration}ms`);
      } catch (err) {
        console.error(`  [cron] ${freshDef.name}/${freshSchedule.name} error:`, err);
        try {
          await failTaskRun(run.id, sanitizeError(err));
        } catch (dbErr) {
          console.error(`  [cron] Failed to record task_run failure for ${run.id}:`, dbErr);
        }
        if (freshSchedule.notify.length > 0) {
          try {
            await notify({
              sourceType: "schedule",
              sourceId: freshSchedule.id,
              targets: freshSchedule.notify,
              summary: `${freshDef.name} failed: ${sanitizeError(err).slice(0, 150)}`,
              detail: { run_id: run.id, agent_name: freshDef.name },
              priority: "high",
              expiresAfter: freshSchedule.notify_expires_after,
            });
          } catch (notifyErr) {
            console.error(`  [cron] ${freshDef.name} failure notification failed:`, notifyErr);
          }
        }
      }
    });
  }
}
