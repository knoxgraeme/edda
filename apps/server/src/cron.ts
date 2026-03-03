/**
 * Local cron runner — uses node-cron for scheduling
 *
 * Reads agent_schedules table to register per-schedule cron tasks. Each
 * execution creates a task_run record for observability. The cron runner
 * is generic — it just invokes agents with their schedule prompt.
 */

import cron from "node-cron";

import {
  getSettings,
  getEnabledSchedules,
  getScheduleById,
  getAgentByName,
  createTaskRun,
  refreshSettings,
  getUnreadNotifications,
  markNotificationsRead,
  deleteExpiredNotifications,
  expirePendingActions,
  claimDueReminders,
  advanceReminderByDate,
  advanceReminderByInterval,
  completeReminder,
  resetStuckSendingReminders,
  countItemsOfTypeSince,
} from "@edda/db";
import type { Notification } from "@edda/db";
import type { EnabledSchedule } from "@edda/db";
import { detectRecurrenceFormat, getNextCronDate } from "./utils/reminder-recurrence.js";

import { resolveThreadId } from "./agent/build-agent.js";
import { executeAgentRun } from "./agent/run-execution.js";
import { runWithConcurrencyLimit } from "./utils/semaphore.js";
import { notify, deliverRunResults } from "./utils/notify.js";
import { getLogger, withTraceId } from "./logger.js";

export interface CronRunner {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createCronRunner(): Promise<CronRunner> {
  const settings = await getSettings();
  if (settings.cron_runner === "langgraph") {
    getLogger().warn(
      "settings.cron_runner=langgraph is not implemented in @edda/server. Falling back to local runner.",
    );
  }
  return new LocalCronRunner();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
    const log = getLogger();
    if (this._running) {
      log.warn("Standalone cron runner is already running");
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
      if (reset > 0) log.info({ count: reset }, "Reset stuck sending reminders");
    } catch (err) {
      log.warn({ err }, "Failed to reset stuck reminders");
    }
    this._reminderInterval = setInterval(() => this.pollReminders(), REMINDER_POLL_INTERVAL_MS);

    log.info({ schedules: this._registered.size }, "Standalone cron runner started");
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
    getLogger().info("Standalone cron runner stopped");
  }

  // ── Schedule registration ──────────────────────────────────────

  private registerSchedule(schedule: EnabledSchedule): void {
    const log = getLogger();
    if (!cron.validate(schedule.cron)) {
      log.warn(
        { agent: schedule.agent_name, schedule: schedule.name, cron: schedule.cron },
        "Skipping schedule — invalid cron expression",
      );
      return;
    }

    const existing = this._registered.get(schedule.id);
    if (existing && existing.cron === schedule.cron) return;

    if (existing) {
      existing.task.stop();
      log.info(
        { agent: schedule.agent_name, schedule: schedule.name, oldCron: existing.cron, newCron: schedule.cron },
        "Schedule cron expression changed",
      );
    }

    const task = cron.schedule(schedule.cron, () =>
      this.executeSchedule(schedule.id, schedule.agent_name),
    );
    this._registered.set(schedule.id, { task, cron: schedule.cron });
    log.info(
      { agent: schedule.agent_name, schedule: schedule.name, cron: schedule.cron },
      "Registered schedule",
    );
  }

  private async syncSchedules(): Promise<void> {
    const log = getLogger();
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
          log.info({ scheduleId: id }, "Unregistered schedule");
        }
      }

      try {
        const deleted = await deleteExpiredNotifications();
        if (deleted > 0) log.info({ count: deleted }, "Cleaned up expired notifications");
      } catch (cleanupErr) {
        log.warn({ err: cleanupErr }, "Failed to clean expired notifications");
      }

      try {
        const expired = await expirePendingActions();
        if (expired > 0) log.info({ count: expired }, "Expired pending actions");
      } catch (cleanupErr) {
        log.warn({ err: cleanupErr }, "Failed to expire pending actions");
      }

      try {
        const reset = await resetStuckSendingReminders();
        if (reset > 0) log.info({ count: reset }, "Reset stuck sending reminders during sync");
      } catch (err) {
        log.warn({ err }, "Failed to reset stuck reminders during sync");
      }

      this.syncFailures = 0;
    } catch (err) {
      this.syncFailures++;
      if (this.syncFailures >= 3) {
        log.error({ err, consecutiveFailures: this.syncFailures }, "syncSchedules failed");
      } else {
        log.warn({ err, consecutiveFailures: this.syncFailures }, "syncSchedules failed");
      }
    }
  }

  // ── Reminder polling ───────────────────────────────────────────

  private async pollReminders(): Promise<void> {
    if (this._reminderPolling) return;
    this._reminderPolling = true;
    try {
      await withTraceId({ module: "reminders" }, async () => {
        const log = getLogger();
        const due = await claimDueReminders();
        if (due.length === 0) return;

        log.info({ count: due.length }, "Firing due reminders");
        const CONCURRENCY = 10;
        for (let i = 0; i < due.length; i += CONCURRENCY) {
          const batch = due.slice(i, i + CONCURRENCY);
          await Promise.allSettled(batch.map((r) => this.fireReminder(r)));
        }
      });
    } catch (err) {
      getLogger().error({ err }, "Reminder poll failed");
    } finally {
      this._reminderPolling = false;
    }
  }

  private async fireReminder(reminder: Notification): Promise<void> {
    const log = getLogger();
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
      log.error({ reminderId: reminder.id, err }, "Failed to deliver reminder");
    }

    // Advance or complete
    if (reminder.recurrence) {
      try {
        const format = detectRecurrenceFormat(reminder.recurrence);
        if (format === "cron") {
          const nextAt = getNextCronDate(reminder.recurrence);
          await advanceReminderByDate(reminder.id, nextAt);
          log.info({ reminderId: reminder.id, nextAt: nextAt.toISOString() }, "Advanced cron reminder");
        } else {
          await advanceReminderByInterval(reminder.id, reminder.recurrence);
          log.info({ reminderId: reminder.id, interval: reminder.recurrence }, "Advanced interval reminder");
        }
      } catch (err) {
        log.error({ reminderId: reminder.id, err }, "Failed to advance reminder");
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
      getLogger().info({ scheduleId }, "Skipping schedule — not found or disabled");
      return;
    }

    const freshDef = await getAgentByName(agentNameHint);
    if (!freshDef || !freshDef.enabled) {
      getLogger().info({ agent: agentNameHint }, "Skipping agent — not found or disabled");
      return;
    }

    // Skip optimization: schedules with skip_when_empty_type are skipped when no new items of that type exist
    if (freshSchedule.skip_when_empty_type) {
      try {
        const count = await countItemsOfTypeSince(freshSchedule.id, freshSchedule.skip_when_empty_type);
        if (count === 0) {
          getLogger().info(
            { agent: agentNameHint, schedule: freshSchedule.name, itemType: freshSchedule.skip_when_empty_type },
            "Skipping schedule — no new items since last run",
          );
          return;
        }
      } catch (err) {
        getLogger().warn({ err, schedule: freshSchedule.name }, "skip_when_empty pre-check failed, proceeding anyway");
      }
    }

    const settings = await refreshSettings();
    const modelName = freshDef.model || settings.default_model;

    const contextAgent = freshSchedule.thread_lifetime
      ? { ...freshDef, thread_lifetime: freshSchedule.thread_lifetime }
      : freshDef;
    const threadId = resolveThreadId(contextAgent, undefined, {
      timezone: settings.user_timezone,
    });

    const run = await createTaskRun({
      agent_id: freshDef.id,
      agent_name: freshDef.name,
      trigger: "cron",
      thread_id: threadId,
      schedule_id: freshSchedule.id,
      model: modelName,
    });

    await runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
      await withTraceId({ module: "cron", agent: freshDef.name, schedule: freshSchedule.name, runId: run.id }, async () => {
        const log = getLogger();
        const startTime = Date.now();
        try {
          log.info("Executing schedule");

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
            log.error({ err: notifyErr }, "Failed to read pending notifications");
          }

          const lastMessage = await executeAgentRun({
            agentDef: freshDef,
            runId: run.id,
            threadId,
            prompt: userMessage,
            trigger: "cron",
          });
          const duration = Date.now() - startTime;

          await deliverRunResults({
            agentId: freshDef.id,
            agentName: freshDef.name,
            runId: run.id,
            lastMessage,
            targets: freshSchedule.notify,
            sourceType: "schedule",
            sourceId: freshSchedule.id,
            detail: { schedule_name: freshSchedule.name },
            expiresAfter: freshSchedule.notify_expires_after,
          });

          log.info({ durationMs: duration }, "Schedule completed");
        } catch (err) {
          log.error({ err }, "Schedule execution failed");
          await deliverRunResults({
            agentId: freshDef.id,
            agentName: freshDef.name,
            runId: run.id,
            lastMessage: undefined,
            targets: freshSchedule.notify,
            sourceType: "schedule",
            sourceId: freshSchedule.id,
            error: err,
            expiresAfter: freshSchedule.notify_expires_after,
          });
        }
      });
    });
  }
}
