/**
 * Standalone cron runner — uses node-cron for scheduling
 *
 * Reads agents table to register scheduled agents. Each execution creates
 * a task_run record for observability. One execution path for ALL agents.
 */

import cron from "node-cron";

import {
  getScheduledAgents,
  getAgentByName,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import { sanitizeError } from "../utils/sanitize-error.js";
import type { Agent } from "@edda/db";

import { buildAgent, resolveThreadId, MODEL_SETTINGS_KEYS } from "../agent/build-agent.js";
import {
  prepareContextRefreshInput,
  finalizeContextRefresh,
  maybeRefreshAgentContext,
} from "../agent/generate-agents-md.js";
import { runWithConcurrencyLimit } from "./semaphore.js";
import { notify } from "../notifications/index.js";
import type { CronRunner } from "./index.js";

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
    if ((m.role === "assistant" || m._getType?.() === "ai") && typeof m.content === "string") {
      return m.content.slice(0, 500);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Timeout helpers
// ---------------------------------------------------------------------------

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Interval constants
// ---------------------------------------------------------------------------

/** How often to sync agents for new/changed/disabled schedules. */
const SCHEDULE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Invocation message builder
// ---------------------------------------------------------------------------

/**
 * Build the user message for an agent invocation.
 * Most agents get a generic prompt. context_refresh gets its template + diff.
 * Returns null if the agent should be skipped (e.g. no changes for context_refresh).
 */
async function buildInvocationMessage(agent: Agent): Promise<string | null> {
  if (agent.name === "context_refresh") {
    return prepareContextRefreshInput();
  }
  return `Execute the ${agent.name} task now.`;
}

// ---------------------------------------------------------------------------
// StandaloneCronRunner class
// ---------------------------------------------------------------------------

export class StandaloneCronRunner implements CronRunner {
  private _registeredAgents = new Map<string, { task: cron.ScheduledTask; schedule: string }>();
  private _syncInterval: NodeJS.Timeout | null = null;
  private _running = false;

  async start(): Promise<void> {
    if (this._running) {
      console.warn("  [cron] Standalone cron runner is already running");
      return;
    }
    this._running = true;

    await refreshSettings();
    const agents = await getScheduledAgents();

    for (const agent of agents) {
      this.registerAgent(agent);
    }

    // Dynamic schedule sync — picks up new/changed/disabled agents
    this._syncInterval = setInterval(() => this.syncSchedules(), SCHEDULE_SYNC_INTERVAL_MS);

    console.log(`  Standalone cron runner started (${this._registeredAgents.size} agent(s))`);
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

    this._running = false;
    console.log("  Standalone cron runner stopped");
  }

  // ── Agent registration ──────────────────────────────────────────

  private registerAgent(agent: Agent): void {
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
      console.log(
        `  [cron] Schedule changed for ${agent.name}: ${existing.schedule} → ${agent.schedule}`,
      );
    }

    const task = cron.schedule(agent.schedule, () => this.executeAgent(agent));
    this._registeredAgents.set(agent.name, { task, schedule: agent.schedule });
    console.log(`  [cron] Registered: ${agent.name} (${agent.schedule})`);
  }

  private async syncSchedules(): Promise<void> {
    try {
      const currentAgents = await getScheduledAgents();
      const currentNames = new Set(currentAgents.map((a) => a.name));

      // Register new agents and detect schedule changes on existing ones
      for (const agent of currentAgents) {
        this.registerAgent(agent);
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

  // ── Agent execution (single path for ALL agents) ──────────────

  private async executeAgent(definition: Agent): Promise<void> {
    // Re-fetch to pick up non-schedule changes (system_prompt, skills, etc.)
    const freshDef = await getAgentByName(definition.name);
    if (!freshDef || !freshDef.enabled) {
      console.log(`  [cron] Skipping ${definition.name} — not found or disabled`);
      return;
    }

    // Build the invocation message (may return null to skip)
    const userMessage = await buildInvocationMessage(freshDef);
    if (!userMessage) {
      console.log(`  [cron] Skipping ${freshDef.name} — no work to do`);
      return;
    }

    const settings = await refreshSettings();
    const modelName =
      freshDef.model_settings_key && MODEL_SETTINGS_KEYS.has(freshDef.model_settings_key)
        ? ((settings as unknown as Record<string, unknown>)[
            freshDef.model_settings_key
          ] as string)
        : undefined;

    const threadId = resolveThreadId(freshDef);

    const run = await createTaskRun({
      agent_id: freshDef.id,
      agent_name: freshDef.name,
      trigger: "cron",
      thread_id: threadId,
      model: modelName,
    });

    await runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
      const startTime = Date.now();
      try {
        await startTaskRun(run.id);
        console.log(`  [cron] Executing: ${freshDef.name}`);

        const agent = await buildAgent(freshDef);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await withTimeout(
          agent.invoke(
            { messages: [{ role: "user", content: userMessage }] },
            { configurable: { thread_id: threadId, agent_name: freshDef.name } },
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

        // Post-execution hooks
        try {
          if (freshDef.name === "context_refresh") {
            await finalizeContextRefresh();
          } else {
            await maybeRefreshAgentContext(freshDef);
          }
        } catch (ctxErr) {
          console.error(
            `  [cron] ${freshDef.name} context refresh failed (agent run was successful):`,
            ctxErr,
          );
        }

        console.log(`  [cron] ${freshDef.name} completed in ${duration}ms`);
      } catch (err) {
        console.error(`  [cron] ${freshDef.name} error:`, err);
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
