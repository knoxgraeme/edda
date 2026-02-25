/**
 * Local cron runner — uses node-cron for scheduling
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
import { withTimeout } from "../utils/with-timeout.js";
import type { Agent } from "@edda/db";

import { buildAgent, resolveThreadId, MODEL_SETTINGS_KEYS } from "../agent/build-agent.js";
import {
  prepareContextRefreshInput,
  finalizeContextRefresh,
  maybeRefreshAgentContext,
} from "../agent/generate-agents-md.js";
import { resolveRetrievalContext } from "../agent/tool-helpers.js";
import { runWithConcurrencyLimit } from "../utils/semaphore.js";
import { notify } from "../utils/notify.js";
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

// ---------------------------------------------------------------------------
// Interval constants
// ---------------------------------------------------------------------------

/** How often to sync agents for new/changed/disabled schedules. */
const SCHEDULE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Metadata-driven invocation hooks (closed allowlist)
// ---------------------------------------------------------------------------

const PRE_HOOKS: Record<string, (agent: Agent) => Promise<string | null>> = {
  prepareContextRefreshInput: () => prepareContextRefreshInput(),
};

const POST_HOOKS: Record<string, (agent: Agent) => Promise<void>> = {
  finalizeContextRefresh: () => finalizeContextRefresh(),
};

// ---------------------------------------------------------------------------
// Invocation message builder
// ---------------------------------------------------------------------------

/**
 * Build the user message for an agent invocation.
 * Dispatches to a pre_invoke hook if one is declared in agent.metadata.hooks.
 * Returns null if the agent should be skipped (e.g. no changes for context_refresh).
 */
async function buildInvocationMessage(agent: Agent): Promise<string | null> {
  const hooks = agent.metadata?.hooks as { pre_invoke?: string } | undefined;
  if (hooks?.pre_invoke && PRE_HOOKS[hooks.pre_invoke]) {
    return PRE_HOOKS[hooks.pre_invoke](agent);
  }
  return `Execute the ${agent.name} task now.`;
}

// ---------------------------------------------------------------------------
// LocalCronRunner class
// ---------------------------------------------------------------------------

export class LocalCronRunner implements CronRunner {
  private _registeredAgents = new Map<string, { task: cron.ScheduledTask; schedule: string }>();
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

        // Post-execution hooks (metadata-driven or default context refresh)
        try {
          const postHooks = freshDef.metadata?.hooks as { post_invoke?: string } | undefined;
          if (postHooks?.post_invoke && POST_HOOKS[postHooks.post_invoke]) {
            await POST_HOOKS[postHooks.post_invoke](freshDef);
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
