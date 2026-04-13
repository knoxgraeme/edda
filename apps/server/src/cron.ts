/**
 * Cron runner — schedules and reminder polling.
 *
 * Two modes (controlled by settings.cron_runner):
 *
 *   - `in_process` (default) — LocalCronRunner uses node-cron to fire
 *     schedules at their cron times, and a 60s setInterval to drain due
 *     reminders. The server process owns the clock. Best for flat-rate
 *     hosts (VPS, Fly min=1, home server) and local development.
 *
 *   - `http_trigger` — the server holds no timers. An external scheduler
 *     (pg_cron, Railway Cron Jobs, GitHub Actions, etc.) hits
 *     `POST /api/cron/tick`, which calls `runCronTick()`. The server is
 *     purely reactive and can scale to zero.
 *
 * Both modes share the same inner functions (`drainReminders`,
 * `fireDueSchedules`, `runScheduleOnce`) and the same safety guarantees:
 *   * Reminders use `FOR UPDATE SKIP LOCKED` inside `claimDueReminders()`.
 *   * Schedules use `claimScheduleFire()` as a compare-and-set on
 *     `agent_schedules.last_fired_at`, so concurrent runners (e.g. an
 *     in_process timer and an external tick hitting the endpoint in the
 *     same second) can never double-fire a schedule.
 */

import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";

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
  claimScheduleFire,
  advanceReminderByDate,
  advanceReminderByInterval,
  completeReminder,
  resetStuckSendingReminders,
  countItemsOfTypeSince,
} from "@edda/db";
import type { Notification, EnabledSchedule } from "@edda/db";

import { detectRecurrenceFormat, getNextCronDate } from "./utils/reminder-recurrence.js";
import { resolveThreadId } from "./agent/build-agent.js";
import { executeAgentRun } from "./agent/run-execution.js";
import { runWithConcurrencyLimit } from "./utils/semaphore.js";
import { notify, deliverRunResults } from "./utils/notify.js";
import { getLogger, withTraceId } from "./logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEDULE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REMINDER_POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const REMINDER_CONCURRENCY = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronTickResult {
  remindersFired: number;
  schedulesFired: number;
  durationMs: number;
}

export interface CronRunner {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Top-level tick — called by POST /api/cron/tick
// ---------------------------------------------------------------------------

/**
 * Single atomic cron tick.
 *
 * Drains due reminders, fires due schedules, and runs maintenance cleanup.
 * Idempotent — safe to call concurrently from multiple sources (the
 * LocalCronRunner's internal timers AND an external scheduler hitting the
 * HTTP endpoint in the same second will not double-fire).
 */
export async function runCronTick(options?: {
  skipSchedules?: boolean;
}): Promise<CronTickResult> {
  const start = Date.now();
  await runMaintenance();
  const remindersFired = await drainReminders();
  const schedulesFired = options?.skipSchedules ? 0 : await fireDueSchedules(new Date());
  return { remindersFired, schedulesFired, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/**
 * Drain all due reminders in one pass. Returns the number fired.
 * Used by both LocalCronRunner's 60s timer and runCronTick().
 */
export async function drainReminders(): Promise<number> {
  return withTraceId({ module: "reminders" }, async () => {
    const log = getLogger();
    const due = await claimDueReminders();
    if (due.length === 0) return 0;

    log.info({ count: due.length }, "Firing due reminders");
    for (let i = 0; i < due.length; i += REMINDER_CONCURRENCY) {
      const batch = due.slice(i, i + REMINDER_CONCURRENCY);
      await Promise.allSettled(batch.map((r) => fireReminder(r)));
    }
    return due.length;
  });
}

async function fireReminder(reminder: Notification): Promise<void> {
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

  // Advance (recurring) or complete (one-shot)
  if (reminder.recurrence) {
    try {
      const format = detectRecurrenceFormat(reminder.recurrence);
      if (format === "cron") {
        const reminderTz = (reminder.detail as Record<string, unknown>)?.timezone as
          | string
          | undefined;
        const nextAt = getNextCronDate(reminder.recurrence, undefined, reminderTz);
        await advanceReminderByDate(reminder.id, nextAt);
        log.info(
          { reminderId: reminder.id, nextAt: nextAt.toISOString() },
          "Advanced cron reminder",
        );
      } else {
        await advanceReminderByInterval(reminder.id, reminder.recurrence);
        log.info(
          { reminderId: reminder.id, interval: reminder.recurrence },
          "Advanced interval reminder",
        );
      }
    } catch (err) {
      log.error({ reminderId: reminder.id, err }, "Failed to advance reminder");
      await completeReminder(reminder.id).catch(() => {});
    }
  } else {
    await completeReminder(reminder.id);
  }
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * Fire all schedules whose most recent cron boundary is newer than their
 * `last_fired_at`. Uses cron-parser to compute the previous fire time for
 * each enabled schedule; the DB column is the source of truth for what's
 * been fired. Called by the http_trigger path from runCronTick().
 *
 * Returns the number of schedules that actually ran (i.e. an agent run
 * was initiated). CAS-lost races, disabled schedules, disabled agents,
 * and skip_when_empty hits are excluded from the count.
 */
export async function fireDueSchedules(now: Date): Promise<number> {
  const log = getLogger();
  const settings = await getSettings();
  const timezone = settings.user_timezone;
  const schedules = await getEnabledSchedules();

  let fired = 0;
  for (const schedule of schedules) {
    try {
      if (!cron.validate(schedule.cron)) {
        log.warn(
          { agent: schedule.agent_name, schedule: schedule.name, cron: schedule.cron },
          "Skipping schedule — invalid cron expression",
        );
        continue;
      }
      const parser = CronExpressionParser.parse(schedule.cron, {
        currentDate: now,
        tz: timezone,
      });
      const prev = parser.prev().toDate();
      const lastFiredAt = new Date(schedule.last_fired_at);
      if (prev <= lastFiredAt) continue;

      // Due — fire via shared path. runScheduleOnce does its own CAS claim
      // and returns true only when the agent run was actually initiated.
      const didFire = await runScheduleOnce(schedule.id, schedule.agent_name, prev);
      if (didFire) fired++;
    } catch (err) {
      log.warn(
        { scheduleId: schedule.id, err },
        "Failed to evaluate schedule for cron tick",
      );
    }
  }
  return fired;
}

/**
 * Execute a single schedule fire.
 *
 * Atomically claims the fire via `claimScheduleFire()` (a compare-and-set
 * on `last_fired_at`) before doing any work, so concurrent callers never
 * double-fire the same schedule. Shared by both the LocalCronRunner
 * node-cron callback and the http_trigger path.
 *
 * Returns `true` only when the agent run was actually initiated. Returns
 * `false` when the CAS claim was lost, the schedule or agent is disabled,
 * or the skip_when_empty optimization fired.
 */
async function runScheduleOnce(
  scheduleId: string,
  agentNameHint: string,
  fireTime: Date,
): Promise<boolean> {
  const claimed = await claimScheduleFire(scheduleId, fireTime);
  if (!claimed) {
    getLogger().debug(
      { scheduleId, fireTime: fireTime.toISOString() },
      "Schedule already fired — another runner won the claim",
    );
    return false;
  }

  const freshSchedule = await getScheduleById(scheduleId);
  if (!freshSchedule || !freshSchedule.enabled) {
    getLogger().info({ scheduleId }, "Skipping schedule — not found or disabled");
    return false;
  }

  const freshDef = await getAgentByName(agentNameHint);
  if (!freshDef || !freshDef.enabled) {
    getLogger().info({ agent: agentNameHint }, "Skipping agent — not found or disabled");
    return false;
  }

  // Skip optimization: schedules with skip_when_empty_type are skipped when no
  // new items of that type exist since the last run.
  if (freshSchedule.skip_when_empty_type) {
    try {
      const count = await countItemsOfTypeSince(
        freshSchedule.id,
        freshSchedule.skip_when_empty_type,
      );
      if (count === 0) {
        getLogger().info(
          {
            agent: agentNameHint,
            schedule: freshSchedule.name,
            itemType: freshSchedule.skip_when_empty_type,
          },
          "Skipping schedule — no new items since last run",
        );
        return false;
      }
    } catch (err) {
      getLogger().warn(
        { err, schedule: freshSchedule.name },
        "skip_when_empty pre-check failed, proceeding anyway",
      );
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
    await withTraceId(
      {
        module: "cron",
        agent: freshDef.name,
        schedule: freshSchedule.name,
        runId: run.id,
      },
      async () => {
        const log = getLogger();
        const startTime = Date.now();
        try {
          log.info("Executing schedule");

          // Passive notification consumption: prepend unread notifications to the prompt.
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
      },
    );
  });

  // Reached the end of the work path — the agent run was initiated.
  // Failures inside `executeAgentRun` still count as a fire, since the
  // task_run row was created and the notify path delivered the error.
  return true;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Cleanup pass — runs on every runCronTick() and every LocalCronRunner sync.
 * All operations are cheap index-backed queries.
 */
async function runMaintenance(): Promise<void> {
  const log = getLogger();
  try {
    const deleted = await deleteExpiredNotifications();
    if (deleted > 0) log.info({ count: deleted }, "Cleaned up expired notifications");
  } catch (err) {
    log.warn({ err }, "Failed to clean expired notifications");
  }
  try {
    const expired = await expirePendingActions();
    if (expired > 0) log.info({ count: expired }, "Expired pending actions");
  } catch (err) {
    log.warn({ err }, "Failed to expire pending actions");
  }
  try {
    const reset = await resetStuckSendingReminders();
    if (reset > 0) log.info({ count: reset }, "Reset stuck sending reminders");
  } catch (err) {
    log.warn({ err }, "Failed to reset stuck reminders");
  }
}

// ---------------------------------------------------------------------------
// Runner factory
// ---------------------------------------------------------------------------

export async function createCronRunner(): Promise<CronRunner> {
  const settings = await getSettings();
  if (settings.cron_runner === "http_trigger") {
    return new HttpTriggerCronRunner();
  }
  if (settings.cron_runner === "langgraph") {
    getLogger().warn(
      "settings.cron_runner=langgraph is not implemented in @edda/server. Falling back to in_process runner.",
    );
  }
  return new LocalCronRunner();
}

// ---------------------------------------------------------------------------
// HttpTriggerCronRunner — no in-process timers
// ---------------------------------------------------------------------------

/**
 * Stub runner for `cron_runner = http_trigger`.
 *
 * All scheduling work is done by an external scheduler hitting
 * `POST /api/cron/tick`. This runner just logs its mode at startup
 * and does nothing else.
 */
export class HttpTriggerCronRunner implements CronRunner {
  async start(): Promise<void> {
    getLogger().info(
      "Cron runner: http_trigger mode — in-process timers disabled. " +
        "An external scheduler must POST /api/cron/tick to drain reminders and fire schedules.",
    );
  }
  async stop(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// LocalCronRunner — in_process mode (node-cron + 60s reminder timer)
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
      log.warn("LocalCronRunner is already running");
      return;
    }
    this._running = true;

    await refreshSettings();
    const schedules = await getEnabledSchedules();

    for (const schedule of schedules) {
      this.registerSchedule(schedule);
    }

    this._syncInterval = setInterval(() => this.syncSchedules(), SCHEDULE_SYNC_INTERVAL_MS);

    // Reminder poller: recover stuck rows, then poll every minute.
    try {
      const reset = await resetStuckSendingReminders();
      if (reset > 0) log.info({ count: reset }, "Reset stuck sending reminders");
    } catch (err) {
      log.warn({ err }, "Failed to reset stuck reminders");
    }
    this._reminderInterval = setInterval(() => this.pollReminders(), REMINDER_POLL_INTERVAL_MS);

    log.info({ schedules: this._registered.size }, "LocalCronRunner started (in_process mode)");
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
    getLogger().info("LocalCronRunner stopped");
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
        {
          agent: schedule.agent_name,
          schedule: schedule.name,
          oldCron: existing.cron,
          newCron: schedule.cron,
        },
        "Schedule cron expression changed",
      );
    }

    // node-cron fires at wall-clock time. runScheduleOnce CAS-claims via
    // claimScheduleFire(new Date()), which correctly serialises against any
    // concurrent http_trigger tick that might compute a prev() in the same
    // second (the CAS compares timestamps strictly, so only one wins).
    const task = cron.schedule(schedule.cron, () =>
      runScheduleOnce(schedule.id, schedule.agent_name, new Date()).catch((err) => {
        log.error(
          { err, scheduleId: schedule.id, agent: schedule.agent_name },
          "Schedule execution failed",
        );
      }),
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

      // Piggy-back maintenance onto the 5-minute sync.
      await runMaintenance();

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
      await drainReminders();
    } catch (err) {
      getLogger().error({ err }, "Reminder poll failed");
    } finally {
      this._reminderPolling = false;
    }
  }
}
