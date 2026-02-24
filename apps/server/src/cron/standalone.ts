/**
 * Standalone cron runner — uses node-cron for scheduling
 *
 * Reads agents table to register scheduled agents. Each execution creates
 * a task_run record for observability. Scheduling is data-driven via
 * getScheduledAgents() with task_runs lifecycle tracking.
 *
 * Also registers user crons (scheduled_task items) via node-cron.
 */

import cron from "node-cron";

import {
  getItemsByType,
  getScheduledAgents,
  getAgentByName,
  getUnprocessedThreads,
  setThreadMetadata,
  createTaskRun,
  startTaskRun,
  completeTaskRun,
  failTaskRun,
  refreshSettings,
} from "@edda/db";
import { sanitizeError } from "../utils/sanitize-error.js";
import type { Agent, Item } from "@edda/db";
import { getSharedCheckpointer } from "../checkpointer/index.js";
import { buildTranscript } from "../agent/message-helpers.js";
import type { MessageLike } from "../agent/message-helpers.js";

import {
  buildChannelAgent,
  resolveThreadId,
  MODEL_SETTINGS_KEYS,
} from "../agent/build-channel-agent.js";
import { runContextRefreshAgent, maybeRefreshAgentContext } from "../agent/generate-agents-md.js";
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
      const settings = await refreshSettings();
      const currentAgents = await getScheduledAgents();
      const currentNames = new Set(currentAgents.map((a) => a.name));

      // Register new agents and detect schedule changes on existing ones
      for (const agent of currentAgents) {
        if (agent.name === "memory_extraction" && !settings.memory_extraction_enabled) continue;
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

  private async executeAgent(definition: Agent): Promise<void> {
    // Re-fetch to pick up non-schedule changes (system_prompt, skills, etc.)
    const freshDef = await getAgentByName(definition.name);
    if (!freshDef || !freshDef.enabled) {
      console.log(`  [cron] Skipping ${definition.name} — not found or disabled`);
      return;
    }

    const settings = await refreshSettings();
    const modelName =
      freshDef.model_settings_key && MODEL_SETTINGS_KEYS.has(freshDef.model_settings_key)
        ? ((settings as unknown as Record<string, unknown>)[
            freshDef.model_settings_key
          ] as string)
        : undefined;

    // context_refresh uses its own subagent pattern, but still gets a task_run
    if (freshDef.name === "context_refresh") {
      await this.executeContextRefresh(freshDef, modelName);
      return;
    }

    // memory_extraction iterates unprocessed threads and invokes post_process for each
    if (freshDef.name === "memory_extraction") {
      await this.executeMemoryExtraction(freshDef);
      return;
    }

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

        const agent = await buildChannelAgent(freshDef);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await withTimeout(
          agent.invoke(
            { messages: [{ role: "user", content: `Execute the ${freshDef.name} task now.` }] },
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
          console.error(`  [cron] ${freshDef.name} notification failed (run was successful):`, notifyErr);
        }

        // Refresh agent's per-agent AGENTS.md context (fast hash check, no LLM)
        try {
          await maybeRefreshAgentContext(freshDef);
        } catch (ctxErr) {
          console.error(`  [cron] ${freshDef.name} context refresh failed (agent run was successful):`, ctxErr);
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

  private async executeContextRefresh(
    definition: Agent,
    modelName: string | undefined,
  ): Promise<void> {
    const run = await createTaskRun({
      agent_id: definition.id,
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
      console.error(`  [cron] context_refresh error:`, err);
      try {
        await failTaskRun(run.id, sanitizeError(err));
      } catch (dbErr) {
        console.error(`  [cron] Failed to record task_run failure for ${run.id}:`, dbErr);
      }
    }
  }

  // ── Memory extraction (unprocessed thread catchup) ──────────────

  private async executeMemoryExtraction(definition: Agent): Promise<void> {
    const postProcessDef = await getAgentByName("post_process");
    if (!postProcessDef || !postProcessDef.enabled) {
      console.warn("  [cron] post_process agent definition not found or disabled, skipping");
      return;
    }

    const threads = await getUnprocessedThreads(50);
    if (threads.length === 0) {
      console.log("  [cron] memory_extraction: no unprocessed threads");
      return;
    }

    const checkpointer = getSharedCheckpointer();
    if (!checkpointer) {
      console.warn("  [cron] Checkpointer not ready, skipping memory_extraction");
      return;
    }

    console.log(`  [cron] memory_extraction: processing ${threads.length} thread(s)`);
    const settings = await refreshSettings();
    let processed = 0;

    // Build the agent once for all threads
    const agent = await buildChannelAgent(postProcessDef);

    await Promise.all(
      threads.map(async (thread) => {
        try {
          // Get messages from checkpointer
          const tuple = await checkpointer.getTuple({
            configurable: { thread_id: thread.thread_id },
          });
          const rawMessages = (tuple?.checkpoint?.channel_values?.messages ?? []) as MessageLike[];
          if (rawMessages.length < 2) {
            await setThreadMetadata(thread.thread_id, {
              processed_by_hook: true,
              processed_at: new Date().toISOString(),
            });
            return;
          }

          const transcript = buildTranscript(rawMessages);
          if (transcript.trim().length < 50) {
            await setThreadMetadata(thread.thread_id, {
              processed_by_hook: true,
              processed_at: new Date().toISOString(),
            });
            return;
          }

          const agentThreadId = resolveThreadId(postProcessDef);
          const run = await createTaskRun({
            agent_id: definition.id,
            agent_name: definition.name,
            trigger: "cron",
            thread_id: agentThreadId,
            input_summary: `Thread ${thread.thread_id}: ${transcript.length} chars`,
          });

          await runWithConcurrencyLimit(settings.task_max_concurrency, async () => {
            const startTime = Date.now();
            try {
              await startTaskRun(run.id);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const result: any = await withTimeout(
                agent.invoke(
                  {
                    messages: [
                      {
                        role: "user",
                        content:
                          `Extract implicit knowledge and entities from this conversation transcript.\n\n` +
                          transcript,
                      },
                    ],
                  },
                  { configurable: { thread_id: agentThreadId, agent_name: postProcessDef.name } },
                ),
                AGENT_TIMEOUT_MS,
                `memory_extraction:${thread.thread_id}`,
              );
              const duration = Date.now() - startTime;
              const lastMessage = extractLastAssistantMessage(result);
              await completeTaskRun(run.id, { output_summary: lastMessage, duration_ms: duration });
              await setThreadMetadata(thread.thread_id, {
                processed_by_hook: true,
                processed_at: new Date().toISOString(),
              });
              processed++;
            } catch (err) {
              console.error(`  [cron] memory_extraction thread ${thread.thread_id} error:`, err);
              try {
                await failTaskRun(run.id, sanitizeError(err));
              } catch (dbErr) {
                console.error(`  [cron] Failed to record task_run failure for ${run.id}:`, dbErr);
              }
            }
          });
        } catch (err) {
          console.error(`  [cron] memory_extraction thread ${thread.thread_id} error:`, err);
        }
      }),
    );

    console.log(`  [cron] memory_extraction: processed ${processed}/${threads.length} thread(s)`);
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
    const taskId = task.id;
    const metadata = task.metadata as {
      cron?: string;
      action?: string;
      cron_human?: string;
    };

    const threadId = `user-cron-${taskId}-${new Date().toISOString().split("T")[0]}`;

    const run = await createTaskRun({
      agent_name: "user_cron",
      trigger: "cron",
      thread_id: threadId,
      input_summary: `Scheduled task: ${task.content}`,
      model: settings.user_cron_model,
    });

    const startTime = Date.now();
    try {
      await startTaskRun(run.id);
      console.log(`  [cron] Executing user cron: ${taskId} — ${metadata.action ?? task.content}`);

      // Build a synthetic Agent for the user cron.
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
        trigger: null,
        tools: [],
        subagents: [],
        scopes: [],
        scope_mode: "boost",
        model_settings_key: "user_cron_model",
        enabled: true,
        metadata: {},
        created_at: "",
        updated_at: "",
      });

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

      await completeTaskRun(run.id, {
        output_summary: outputSummary,
        duration_ms: durationMs,
      });

      console.log(`  [cron] User cron ${taskId} completed in ${durationMs}ms`);
    } catch (err) {
      console.error(`  [cron] User cron ${taskId} error:`, err);
      try {
        await failTaskRun(run.id, sanitizeError(err));
      } catch (dbErr) {
        console.error(`  [cron] Failed to record task_run failure for ${run.id}:`, dbErr);
      }
    }
  }
}
