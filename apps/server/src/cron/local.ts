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
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import type { EnabledSchedule } from "@edda/db";
import { sanitizeError } from "../utils/sanitize-error.js";
import { withTimeout } from "../utils/with-timeout.js";

import { buildAgent, resolveThreadId, MODEL_SETTINGS_KEYS } from "../agent/build-agent.js";
import { resolveRetrievalContext } from "../agent/tool-helpers.js";
import { runWithConcurrencyLimit } from "../utils/semaphore.js";
import { notify } from "../utils/notify.js";
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
      return m.content.slice(0, 500);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SCHEDULE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// LocalCronRunner class
// ---------------------------------------------------------------------------

export class LocalCronRunner implements CronRunner {
  /** Keyed by schedule ID */
  private _registered = new Map<string, { task: cron.ScheduledTask; cron: string }>();
  private _syncInterval: NodeJS.Timeout | null = null;
  private _running = false;
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

    const contextAgent = freshSchedule.context_mode
      ? { ...freshDef, context_mode: freshSchedule.context_mode }
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

        const agent = await buildAgent(freshDef);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await withTimeout(
          agent.invoke(
            { messages: [{ role: "user", content: freshSchedule.prompt }] },
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
        await completeTaskRun(run.id, { output_summary: lastMessage, duration_ms: duration });

        try {
          await notify({
            agentName: freshDef.name,
            runId: run.id,
            summary: lastMessage?.slice(0, 200) ?? `${freshDef.name} completed`,
          });
        } catch (notifyErr) {
          console.error(
            `  [cron] ${freshDef.name} notification failed (run was successful):`,
            notifyErr,
          );
        }

        console.log(`  [cron] ${freshDef.name}/${freshSchedule.name} completed in ${duration}ms`);
      } catch (err) {
        console.error(`  [cron] ${freshDef.name}/${freshSchedule.name} error:`, err);
        try {
          await failTaskRun(run.id, sanitizeError(err));
        } catch (dbErr) {
          console.error(`  [cron] Failed to record task_run failure for ${run.id}:`, dbErr);
        }
        try {
          await notify({
            agentName: freshDef.name,
            runId: run.id,
            summary: `${freshDef.name} failed: ${sanitizeError(err).slice(0, 150)}`,
            priority: "high",
          });
        } catch (notifyErr) {
          console.error(`  [cron] ${freshDef.name} failure notification failed:`, notifyErr);
        }
      }
    });
  }
}
