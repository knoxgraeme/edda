/**
 * Standalone cron runner — uses node-cron for scheduling
 *
 * Reads agent_definitions to register scheduled agents. Each execution creates
 * a task_run record for observability. The old SYSTEM_CRONS array and
 * createAgentLog calls are replaced by data-driven scheduling via
 * getScheduledAgents() and task_runs lifecycle tracking.
 *
 * Also runs a user-cron poller for scheduled_task items.
 */

import cron from "node-cron";

import {
  getItemsByType,
  getScheduledAgents,
  createAgentLog,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import type { AgentDefinition, Settings, Item } from "@edda/db";

import { buildChannelAgent, resolveThreadId } from "../agent/build-channel-agent.js";
import {
  runContextRefreshAgent,
  maybeRefreshAgentContext,
} from "../agent/generate-agents-md.js";
import { runWithConcurrencyLimit } from "./semaphore.js";
import type { CronRunner } from "./index.js";

/** Allowlist of settings keys that can be used as model overrides. */
const MODEL_SETTINGS_KEYS = new Set([
  "default_model",
  "daily_digest_model",
  "memory_extraction_model",
  "weekly_review_model",
  "type_evolution_model",
  "context_refresh_model",
  "user_cron_model",
  "memory_sync_model",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the last assistant message content from an agent invocation result.
 * Returns undefined if no assistant message is found.
 */
function extractLastAssistantMessage(result: {
  messages?: Array<{ role?: string; content?: unknown; _getType?: () => string }>;
}): string | undefined {
  const messages = result?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      (m.role === "assistant" || m._getType?.() === "ai") &&
      typeof m.content === "string"
    ) {
      return m.content.slice(0, 500);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Cron expression helpers (used by user cron poller)
// ---------------------------------------------------------------------------

/**
 * Determine whether a cron expression should fire given the last run time.
 * Checks if the current minute matches the cron pattern AND the job has not
 * already run in this minute window.
 */
export function shouldFire(
  cronExpression: string,
  lastRunAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!cron.validate(cronExpression)) {
    console.warn(`  [cron] Invalid cron expression: ${cronExpression}`);
    return false;
  }

  // Parse cron fields: minute hour dayOfMonth month dayOfWeek
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const matches = cronFieldMatches(parts, now);
  if (!matches) return false;

  // If no last run, fire immediately on first match
  if (!lastRunAt) return true;

  // Ensure we don't fire twice in the same minute
  const nowMinute = Math.floor(now.getTime() / 60000);
  const lastMinute = Math.floor(lastRunAt.getTime() / 60000);
  return nowMinute > lastMinute;
}

/**
 * Check if the given date matches all fields of a cron expression.
 */
function cronFieldMatches(parts: string[], date: Date): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // 1-indexed
  const dayOfWeek = date.getDay(); // 0=Sunday

  return (
    fieldMatches(parts[0], minute, 0, 59) &&
    fieldMatches(parts[1], hour, 0, 23) &&
    fieldMatches(parts[2], dayOfMonth, 1, 31) &&
    fieldMatches(parts[3], month, 1, 12) &&
    fieldMatches(parts[4], dayOfWeek, 0, 7) // 0 and 7 both = Sunday
  );
}

/**
 * Check if a single cron field matches a value.
 * Supports: star, numbers, ranges (1-5), steps (star/5, 1-10/2), lists (1,3,5).
 */
function fieldMatches(field: string, value: number, _min: number, _max: number): boolean {
  if (field === "*") return true;

  // Handle lists: "1,3,5"
  const parts = field.split(",");
  for (const part of parts) {
    if (partMatches(part.trim(), value)) return true;
  }
  return false;
}

function partMatches(part: string, value: number): boolean {
  // Handle step: "*/5" or "1-10/2"
  const stepParts = part.split("/");
  const step = stepParts.length > 1 ? parseInt(stepParts[1], 10) : 1;
  const range = stepParts[0];

  if (range === "*") {
    return value % step === 0;
  }

  // Handle range: "1-5"
  if (range.includes("-")) {
    const [startStr, endStr] = range.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  }

  // Plain number
  return parseInt(range, 10) === value;
}

// ---------------------------------------------------------------------------
// Interval constants
// ---------------------------------------------------------------------------

/** How often to sync agent_definitions for new/changed/disabled schedules. */
const SCHEDULE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Default fallback for user cron polling interval. */
const DEFAULT_USER_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// StandaloneCronRunner class
// ---------------------------------------------------------------------------

export class StandaloneCronRunner implements CronRunner {
  private _registeredAgents = new Map<string, { task: cron.ScheduledTask; schedule: string }>();
  private _syncInterval: NodeJS.Timeout | null = null;
  private _userCronInterval: NodeJS.Timeout | null = null;
  private _running = false;

  /** Track last run time per user cron (scheduled_task item ID) */
  private _userCronLastRuns = new Map<string, Date>();

  async start(): Promise<void> {
    if (this._running) {
      console.warn("  [cron] Standalone cron runner is already running");
      return;
    }
    this._running = true;

    const settings = await refreshSettings();
    const agents = await getScheduledAgents();

    for (const agent of agents) {
      if (agent.name === "memory_extraction" && !settings.memory_extraction_enabled) continue;
      this.registerAgent(agent);
    }

    // Dynamic schedule sync — picks up new/changed/disabled agents
    this._syncInterval = setInterval(() => this.syncSchedules(), SCHEDULE_SYNC_INTERVAL_MS);

    // User cron poller (preserved from existing code)
    if (settings.user_crons_enabled) {
      this.startUserCronPoller(settings);
    }

    const registeredCount = this._registeredAgents.size;
    console.log(
      `  Standalone cron runner started (${registeredCount} agent(s)` +
        `${settings.user_crons_enabled ? " + user cron poller" : ""})`,
    );
  }

  async stop(): Promise<void> {
    if (!this._running) return;

    for (const entry of this._registeredAgents.values()) {
      entry.task.stop();
    }
    this._registeredAgents.clear();

    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }

    if (this._userCronInterval) {
      clearInterval(this._userCronInterval);
      this._userCronInterval = null;
    }

    this._running = false;
    this._userCronLastRuns.clear();
    console.log("  Standalone cron runner stopped");
  }

  // ── Agent registration ──────────────────────────────────────────

  private registerAgent(agent: AgentDefinition): void {
    if (!agent.schedule || !cron.validate(agent.schedule)) {
      console.warn(`  [cron] Skipping ${agent.name} — invalid schedule: ${agent.schedule}`);
      return;
    }

    // If already registered with the same schedule, skip
    const existing = this._registeredAgents.get(agent.name);
    if (existing && existing.schedule === agent.schedule) return;

    // If schedule changed, stop the old task first
    if (existing) {
      existing.task.stop();
      console.log(`  [cron] Schedule changed for ${agent.name}: ${existing.schedule} → ${agent.schedule}`);
    }

    const task = cron.schedule(agent.schedule, () => this.executeAgent(agent));
    this._registeredAgents.set(agent.name, { task, schedule: agent.schedule });
    console.log(`  [cron] Registered: ${agent.name} (${agent.schedule})`);
  }

  private async syncSchedules(): Promise<void> {
    try {
      const settings = await refreshSettings();
      const currentAgents = await getScheduledAgents();
      const currentNames = new Set(currentAgents.map((a) => a.name));

      // Register new agents
      for (const agent of currentAgents) {
        if (agent.name === "memory_extraction" && !settings.memory_extraction_enabled) continue;
        if (!this._registeredAgents.has(agent.name)) {
          this.registerAgent(agent);
        }
      }

      // Stop removed/disabled agents
      for (const [name, entry] of this._registeredAgents) {
        if (!currentNames.has(name)) {
          entry.task.stop();
          this._registeredAgents.delete(name);
          console.log(`  [cron] Unregistered: ${name}`);
        }
      }
    } catch (err) {
      console.error("  [cron] Schedule sync failed:", err);
    }
  }

  // ── Agent execution ─────────────────────────────────────────────

  private async executeAgent(definition: AgentDefinition): Promise<void> {
    const settings = await refreshSettings();
    const modelName =
      definition.model_settings_key && MODEL_SETTINGS_KEYS.has(definition.model_settings_key)
        ? ((settings as unknown as Record<string, unknown>)[definition.model_settings_key] as string)
        : undefined;

    // context_refresh uses its own subagent pattern, but still gets a task_run
    if (definition.name === "context_refresh") {
      await this.executeContextRefresh(definition, modelName);
      return;
    }

    const threadId = resolveThreadId(definition);

    const run = await createTaskRun({
      agent_definition_id: definition.id,
      agent_name: definition.name,
      trigger: "cron",
      thread_id: threadId,
      model: modelName,
    });

    await runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
      const startTime = Date.now();
      try {
        await startTaskRun(run.id);
        console.log(`  [cron] Executing: ${definition.name}`);

        const agent = await buildChannelAgent(definition);
        const result = await agent.invoke(
          { messages: [{ role: "user", content: `Execute the ${definition.name} task now.` }] },
          { configurable: { thread_id: threadId, agent_name: definition.name } },
        );

        const duration = Date.now() - startTime;
        const lastMessage = extractLastAssistantMessage(result);
        await completeTaskRun(run.id, { output_summary: lastMessage, duration_ms: duration });

        // Refresh agent's per-agent AGENTS.md context (fast hash check, no LLM)
        await maybeRefreshAgentContext(definition);

        console.log(`  [cron] ${definition.name} completed in ${duration}ms`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await failTaskRun(run.id, errorMsg);
        console.error(`  [cron] ${definition.name} failed: ${errorMsg}`);
      }
    });
  }

  private async executeContextRefresh(
    definition: AgentDefinition,
    modelName: string | undefined,
  ): Promise<void> {
    const run = await createTaskRun({
      agent_definition_id: definition.id,
      agent_name: definition.name,
      trigger: "cron",
      thread_id: `context-refresh-${new Date().toISOString().split("T")[0]}`,
      model: modelName,
    });

    const startTime = Date.now();
    try {
      await startTaskRun(run.id);
      console.log("  [cron] Executing: context_refresh");

      await runContextRefreshAgent();

      await completeTaskRun(run.id, { duration_ms: Date.now() - startTime });
      console.log(`  [cron] context_refresh completed in ${Date.now() - startTime}ms`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await failTaskRun(run.id, errorMsg);
      console.error(`  [cron] context_refresh failed: ${errorMsg}`);
    }
  }

  // ── User cron poller ────────────────────────────────────────────

  private startUserCronPoller(settings: Settings): void {
    const checkIntervalMs = this.parseCronToMs(settings.user_cron_check_interval);

    this._userCronInterval = setInterval(async () => {
      const freshSettings = await refreshSettings();
      await this.checkUserCrons(freshSettings);
    }, checkIntervalMs);

    console.log(
      `  [cron] User cron poller started (interval: ${checkIntervalMs / 1000}s)`,
    );
  }

  private async checkUserCrons(settings: Settings): Promise<void> {
    if (!settings.user_crons_enabled) return;

    try {
      const tasks = await getItemsByType("scheduled_task", "active");
      const now = new Date();

      for (const task of tasks) {
        const metadata = task.metadata as {
          cron?: string;
          enabled?: boolean;
          action?: string;
          cron_human?: string;
        };

        if (metadata.enabled === false) continue;

        if (!metadata.cron) {
          console.warn(`  [cron] scheduled_task ${task.id} has no cron expression`);
          continue;
        }

        const lastRun = this._userCronLastRuns.get(task.id) ?? null;
        if (shouldFire(metadata.cron, lastRun, now)) {
          await this.executeUserCron(task, settings);
        }
      }
    } catch (err) {
      console.error("  [cron] Error checking user crons:", err);
    }
  }

  private async executeUserCron(task: Item, settings: Settings): Promise<void> {
    const startTime = Date.now();
    const taskId = task.id;
    const metadata = task.metadata as {
      cron?: string;
      action?: string;
      cron_human?: string;
    };

    console.log(`  [cron] Executing user cron: ${taskId} — ${metadata.action ?? task.content}`);

    try {
      // Build a synthetic AgentDefinition for the user cron.
      // skills: [] → gets full eddaTools (same as old createEddaAgent)
      const agent = await buildChannelAgent({
        id: "",
        name: "user_cron",
        description: "User-scheduled recurring task",
        system_prompt:
          `You are Edda, executing a user-scheduled recurring task.` +
          ` Today is ${new Date().toISOString().split("T")[0]}.` +
          ` The user's timezone is ${settings.user_timezone}.` +
          (settings.user_display_name ? ` The user's name is ${settings.user_display_name}.` : "") +
          `\n\nScheduled task: ${task.content}` +
          `\nSchedule: ${metadata.cron_human ?? metadata.cron}` +
          `\nAction: ${metadata.action ?? task.content}` +
          `\n\nExecute this action using the available tools. Be concise and effective.`,
        skills: [],
        schedule: null,
        context_mode: "daily",
        output_mode: "items",
        scopes: [],
        scope_mode: "boost",
        model_settings_key: "user_cron_model",
        built_in: false,
        enabled: true,
        metadata: {},
        created_at: "",
        updated_at: "",
      });

      const threadId = `user-cron-${taskId}-${new Date().toISOString().split("T")[0]}`;
      const result = await agent.invoke(
        {
          messages: [
            {
              role: "user",
              content: `Execute the scheduled task now: ${metadata.action ?? task.content}`,
            },
          ],
        },
        {
          configurable: {
            thread_id: threadId,
            agent_name: "user_cron",
          },
        },
      );

      const durationMs = Date.now() - startTime;
      const outputSummary = extractLastAssistantMessage(result) ?? `User cron ${taskId} completed`;

      // User crons still log to agent_log (no agent_definition to create task_runs)
      await createAgentLog({
        skill: "user_cron",
        trigger: "user_cron",
        input_summary: `Scheduled task: ${task.content}`,
        output_summary: outputSummary,
        model: settings.user_cron_model,
        duration_ms: durationMs,
      });

      this._userCronLastRuns.set(taskId, new Date());
      console.log(`  [cron] User cron ${taskId} completed in ${durationMs}ms`);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [cron] User cron ${taskId} failed: ${errorMsg}`);

      await createAgentLog({
        skill: "user_cron",
        trigger: "user_cron",
        input_summary: `Scheduled task: ${task.content}`,
        output_summary: `ERROR: ${errorMsg.slice(0, 500)}`,
        duration_ms: durationMs,
      }).catch((logErr) => {
        console.error(`  [cron] Failed to log error for user cron ${taskId}:`, logErr);
      });
    }
  }

  // ── Cron interval parser ────────────────────────────────────────

  /** Parse a cron expression into a millisecond interval. Falls back to 5 minutes. */
  private parseCronToMs(cronExpr: string): number {
    if (!cronExpr) return DEFAULT_USER_CRON_INTERVAL_MS;

    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) return DEFAULT_USER_CRON_INTERVAL_MS;

    // Handle simple minute-based intervals: "*/N * * * *"
    const minuteField = parts[0];
    if (minuteField.startsWith("*/")) {
      const minutes = parseInt(minuteField.slice(2), 10);
      if (!isNaN(minutes) && minutes > 0) {
        return minutes * 60 * 1000;
      }
    }

    // For complex patterns, default to checking every 1 minute
    // (the shouldFire function will handle the actual schedule matching)
    return 60 * 1000;
  }
}
