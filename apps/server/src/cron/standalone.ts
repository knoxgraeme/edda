/**
 * Standalone cron runner — uses node-cron for scheduling
 *
 * Reads agent_definitions to register scheduled agents. Each execution creates
 * a task_run record for observability. The old SYSTEM_CRONS array and
 * createAgentLog calls are replaced by data-driven scheduling via
 * getScheduledAgents() and task_runs lifecycle tracking.
 *
 * Also registers user crons (scheduled_task items) via node-cron.
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
import type { AgentDefinition, Item } from "@edda/db";

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
// Interval constants
// ---------------------------------------------------------------------------

/** How often to sync agent_definitions for new/changed/disabled schedules. */
const SCHEDULE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// StandaloneCronRunner class
// ---------------------------------------------------------------------------

export class StandaloneCronRunner implements CronRunner {
  private _registeredAgents = new Map<string, { task: cron.ScheduledTask; schedule: string }>();
  private _registeredUserCrons = new Map<string, { task: cron.ScheduledTask; schedule: string }>();
  private _syncInterval: NodeJS.Timeout | null = null;
  private _running = false;

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

    // Register user crons via node-cron (same pattern as system agents)
    if (settings.user_crons_enabled) {
      await this.syncUserCrons();
    }

    const registeredCount = this._registeredAgents.size;
    const userCronCount = this._registeredUserCrons.size;
    console.log(
      `  Standalone cron runner started (${registeredCount} agent(s)` +
        `${settings.user_crons_enabled ? `, ${userCronCount} user cron(s)` : ""})`,
    );
  }

  async stop(): Promise<void> {
    if (!this._running) return;

    for (const entry of this._registeredAgents.values()) {
      entry.task.stop();
    }
    this._registeredAgents.clear();

    for (const entry of this._registeredUserCrons.values()) {
      entry.task.stop();
    }
    this._registeredUserCrons.clear();

    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }

    this._running = false;
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

      // Sync user crons
      if (settings.user_crons_enabled) {
        await this.syncUserCrons();
      } else {
        // If user crons were disabled, stop all registered user crons
        for (const [id, entry] of this._registeredUserCrons) {
          entry.task.stop();
          console.log(`  [cron] Unregistered user cron: ${id}`);
        }
        this._registeredUserCrons.clear();
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

  // ── User cron scheduling ────────────────────────────────────────

  private async syncUserCrons(): Promise<void> {
    try {
      const tasks = await getItemsByType("scheduled_task", "active");
      const activeIds = new Set<string>();

      for (const task of tasks) {
        const metadata = task.metadata as {
          cron?: string;
          enabled?: boolean;
          action?: string;
          cron_human?: string;
        };

        if (metadata.enabled === false) continue;

        if (!metadata.cron || !cron.validate(metadata.cron)) {
          console.warn(
            `  [cron] scheduled_task ${task.id} has invalid/missing cron: ${metadata.cron}`,
          );
          continue;
        }

        activeIds.add(task.id);

        const existing = this._registeredUserCrons.get(task.id);
        if (existing && existing.schedule === metadata.cron) continue;

        // Schedule changed or new task — (re-)register
        if (existing) {
          existing.task.stop();
          console.log(
            `  [cron] User cron ${task.id} schedule changed: ${existing.schedule} → ${metadata.cron}`,
          );
        }

        const scheduledTask = cron.schedule(metadata.cron, () => this.executeUserCron(task));
        this._registeredUserCrons.set(task.id, { task: scheduledTask, schedule: metadata.cron });
        console.log(
          `  [cron] Registered user cron: ${task.id} (${metadata.cron}) — ${metadata.action ?? task.content}`,
        );
      }

      // Stop user crons no longer in the active set
      for (const [id, entry] of this._registeredUserCrons) {
        if (!activeIds.has(id)) {
          entry.task.stop();
          this._registeredUserCrons.delete(id);
          console.log(`  [cron] Unregistered user cron: ${id}`);
        }
      }
    } catch (err) {
      console.error("  [cron] Error syncing user crons:", err);
    }
  }

  private async executeUserCron(task: Item): Promise<void> {
    const settings = await refreshSettings();
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

}
