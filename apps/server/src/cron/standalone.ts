/**
 * Standalone cron runner — uses node-cron for scheduling
 * Self-hosted, no platform dependency.
 *
 * Registers four system crons (daily_digest, memory_extraction, weekly_reflect,
 * type_evolution) plus a user-cron poller. Each system cron spawns a disposable
 * agent via createEddaAgent() with a cron-specific thread, then logs the result
 * to agent_log.
 */

import cron from "node-cron";

import {
  getItemsByType,
  createAgentLog,
  refreshSettings,
} from "@edda/db";
import type { Settings, Item, CreateAgentLogInput } from "@edda/db";

import { createEddaAgent } from "../agent/index.js";
import type { CronRunner } from "./index.js";

// ---------------------------------------------------------------------------
// System cron definitions
// ---------------------------------------------------------------------------

/** Narrow `keyof Settings` to only keys whose value type is `string`. */
type StringSettingsKey = {
  [K in keyof Settings]: Settings[K] extends string ? K : never;
}[keyof Settings];

interface SystemCronConfig {
  /** Skill name — matches SKILL.md directory name */
  name: string;
  /** Settings key for the cron expression */
  cronKey: StringSettingsKey;
  /** Settings key for the model to use */
  modelKey: StringSettingsKey;
  /** Whether this cron requires memory_extraction_enabled */
  requiresMemoryExtraction?: boolean;
  /** System prompt for the disposable agent */
  buildPrompt: (settings: Settings) => string;
}

const SYSTEM_CRONS: SystemCronConfig[] = [
  {
    name: "daily_digest",
    cronKey: "daily_digest_cron",
    modelKey: "daily_digest_model",
    buildPrompt: (s) =>
      `You are Edda's daily digest agent. Today is ${new Date().toISOString().split("T")[0]}.` +
      ` The user's timezone is ${s.user_timezone}.` +
      (s.user_display_name ? ` The user's name is ${s.user_display_name}.` : "") +
      `\n\nYour task: Generate a daily digest.` +
      `\n1. Get yesterday's items (captured, completed) using get_timeline.` +
      `\n2. Get today's due items using get_dashboard.` +
      `\n3. Get upcoming items for the next 3 days using get_timeline.` +
      `\n4. Count open items and stale items.` +
      `\n5. Get active list summaries using get_list_items for known lists.` +
      `\n6. Create a daily_digest item with source='cron' summarizing everything.` +
      `\n\nBe concise. Focus on actionable information.`,
  },
  {
    name: "memory_extraction",
    cronKey: "memory_extraction_cron",
    modelKey: "memory_extraction_model",
    requiresMemoryExtraction: true,
    buildPrompt: (s) =>
      `You are Edda's memory extraction agent. Today is ${new Date().toISOString().split("T")[0]}.` +
      `\n\nYour task: Review unprocessed conversation threads and extract missed implicit knowledge.` +
      `\n1. Use get_agent_knowledge to see existing memories (avoid duplicates).` +
      `\n2. For any new preferences, facts, or patterns discovered, create items with` +
      ` type='preference'/'learned_fact'/'pattern', source='cron'.` +
      `\n3. For any entities discovered, use upsert_entity and link_item_entity.` +
      `\n\nMemory dedup thresholds: reinforce > ${s.memory_reinforce_threshold},` +
      ` update ${s.memory_update_threshold}-${s.memory_reinforce_threshold},` +
      ` insert < ${s.memory_update_threshold}.` +
      `\nEntity thresholds: exact > ${s.entity_exact_threshold},` +
      ` fuzzy ${s.entity_fuzzy_threshold}-${s.entity_exact_threshold}.`,
  },
  {
    name: "weekly_reflect",
    cronKey: "weekly_review_cron",
    modelKey: "weekly_review_model",
    buildPrompt: (s) =>
      `You are Edda's weekly reflection agent. Today is ${new Date().toISOString().split("T")[0]}.` +
      ` The user's timezone is ${s.user_timezone}.` +
      (s.user_display_name ? ` The user's name is ${s.user_display_name}.` : "") +
      `\n\nYour task: Perform a weekly review and memory maintenance.` +
      `\n\n## Activity Analysis` +
      `\n1. Pull all items from the past 7 days using get_timeline.` +
      `\n2. Analyze items by type, completion rate, busiest day.` +
      `\n3. Identify most mentioned entities.` +
      `\n4. Flag stale items (open too long).` +
      `\n5. Detect dropped threads — entities active 2+ weeks ago with no recent mentions.` +
      `\n6. If cross-conversation patterns detected, create items type='pattern', source='cron'.` +
      `\n\n## Memory Maintenance` +
      `\n7. Search for near-duplicate agent-internal items (preference, learned_fact, pattern)` +
      `   using search_items. Merge duplicates by creating a consolidated item and archiving originals.` +
      `\n8. Archive stale memories (not reinforced in 90+ days).` +
      `\n9. Resolve contradictions in learned_facts — keep most recent, archive older.` +
      `\n10. For entities with many links, regenerate descriptions.` +
      `\n\n## Output` +
      `\nCreate item: type='insight', source='cron' with the full weekly summary` +
      ` including a memory maintenance section.`,
  },
  {
    name: "type_evolution",
    cronKey: "type_evolution_cron",
    modelKey: "type_evolution_model",
    buildPrompt: (s) =>
      `You are Edda's type evolution agent. Today is ${new Date().toISOString().split("T")[0]}.` +
      `\n\nYour task: Evolve the type system based on usage patterns.` +
      `\n1. Search for items where type='note' from the last 30 days using search_items or get_timeline.` +
      `\n2. Look for clusters of similar notes that could be a new type.` +
      `\n3. For clusters of 5+ similar items:` +
      `\n   a. Check if an existing type could absorb them — propose reclassify.` +
      `\n   b. If no match, draft a new type via create_item_type.` +
      `\n4. Approval mode: ${s.approval_new_type}.` +
      (s.approval_new_type === "confirm"
        ? `\n   Set confirmed=false, pending_action describing the proposal.`
        : `\n   Set confirmed=true and reclassify matching items.`) +
      `\n\nGuard rails: Max 30 total types. Never auto-delete a type.` +
      `\nIf two custom types overlap >50% shared items, propose merge.`,
  },
];

// ---------------------------------------------------------------------------
// Cron expression helpers
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
// StandaloneCronRunner class
// ---------------------------------------------------------------------------

export class StandaloneCronRunner implements CronRunner {
  private scheduledTasks: cron.ScheduledTask[] = [];
  private userCronInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Track last run time per system cron name */
  private lastRunTimes = new Map<string, Date>();

  /** Track last run time per user cron (scheduled_task item ID) */
  private userCronLastRuns = new Map<string, Date>();

  async start(): Promise<void> {
    if (this.running) {
      console.warn("  [cron] Standalone cron runner is already running");
      return;
    }
    this.running = true;

    // Refresh settings to get latest cron schedules
    const settings = await refreshSettings();

    // Register system crons via node-cron
    for (const cronConfig of SYSTEM_CRONS) {
      const cronExpr = settings[cronConfig.cronKey];
      if (!cronExpr) {
        console.log(`  [cron] Skipping ${cronConfig.name} — no cron expression configured`);
        continue;
      }

      // Skip memory_extraction if disabled
      if (cronConfig.requiresMemoryExtraction && !settings.memory_extraction_enabled) {
        console.log(`  [cron] Skipping ${cronConfig.name} — memory extraction disabled`);
        continue;
      }

      if (!cron.validate(cronExpr)) {
        console.error(`  [cron] Invalid cron expression for ${cronConfig.name}: ${cronExpr}`);
        continue;
      }

      const task = cron.schedule(cronExpr, async () => {
        // Re-read settings each invocation so schedule/model changes take effect
        const freshSettings = await refreshSettings();
        await this.executeCron(cronConfig, freshSettings);
      });

      this.scheduledTasks.push(task);
      console.log(`  [cron] Registered system cron: ${cronConfig.name} (${cronExpr})`);
    }

    // Register user cron poller via setInterval
    if (settings.user_crons_enabled) {
      const checkIntervalMs = this.parseCronToMs(settings.user_cron_check_interval);

      this.userCronInterval = setInterval(async () => {
        const freshSettings = await refreshSettings();
        await this.checkUserCrons(freshSettings);
      }, checkIntervalMs);

      console.log(
        `  [cron] User cron poller started (interval: ${checkIntervalMs / 1000}s)`,
      );
    }

    const registeredCount = this.scheduledTasks.length;
    console.log(
      `  Standalone cron runner started (${registeredCount} system cron(s)` +
        `${settings.user_crons_enabled ? " + user cron poller" : ""})`,
    );
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    // Stop all node-cron scheduled tasks
    for (const task of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks = [];

    // Stop user cron poller
    if (this.userCronInterval) {
      clearInterval(this.userCronInterval);
      this.userCronInterval = null;
    }

    this.running = false;
    this.lastRunTimes.clear();
    this.userCronLastRuns.clear();

    console.log("  Standalone cron runner stopped");
  }

  /**
   * Execute a system cron job. Spawns a disposable agent via createEddaAgent(),
   * invokes it with the cron-specific prompt, and logs the result to agent_log.
   */
  private async executeCron(cronConfig: SystemCronConfig, settings: Settings): Promise<void> {
    const startTime = Date.now();
    const cronName = cronConfig.name;

    console.log(`  [cron] Executing system cron: ${cronName}`);

    try {
      const modelName = settings[cronConfig.modelKey];
      const systemPrompt = cronConfig.buildPrompt(settings);

      // Spawn a disposable agent with full Edda tools
      const agent = await createEddaAgent();

      // Invoke the agent with the cron's system prompt as a human message.
      // Each cron gets a unique thread_id per day to avoid state collisions.
      const result = await agent.invoke(
        {
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content:
                `Execute the ${cronName} cron job now. Use the available tools to complete the task.`,
            },
          ],
        },
        {
          configurable: {
            thread_id: `system-cron-${cronName}-${new Date().toISOString().split("T")[0]}`,
            model: modelName,
          },
        },
      );

      const durationMs = Date.now() - startTime;

      // Extract summary from the last assistant message
      const messages = (result?.messages ?? []) as Array<{
        role?: string;
        content?: string;
        _getType?: () => string;
      }>;
      const lastAssistantMsg = [...messages]
        .reverse()
        .find((m) => m.role === "assistant" || m._getType?.() === "ai");
      const outputSummary =
        typeof lastAssistantMsg?.content === "string"
          ? lastAssistantMsg.content.slice(0, 500)
          : `${cronName} completed`;

      // Log to agent_log
      const logInput: CreateAgentLogInput = {
        skill: cronName,
        trigger: "system_cron",
        input_summary: `System cron: ${cronName}`,
        output_summary: outputSummary,
        model: modelName,
        duration_ms: durationMs,
      };

      await createAgentLog(logInput);
      this.lastRunTimes.set(cronName, new Date());

      console.log(`  [cron] ${cronName} completed in ${durationMs}ms`);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [cron] ${cronName} failed: ${errorMsg}`);

      // Log the error to agent_log
      await createAgentLog({
        skill: cronName,
        trigger: "system_cron",
        input_summary: `System cron: ${cronName}`,
        output_summary: `ERROR: ${errorMsg.slice(0, 500)}`,
        duration_ms: durationMs,
      }).catch((logErr) => {
        console.error(`  [cron] Failed to log error for ${cronName}:`, logErr);
      });
    }
  }

  /**
   * Poll scheduled_task items and execute any that are due.
   */
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

        // Skip disabled tasks
        if (metadata.enabled === false) continue;

        // Skip tasks without a cron expression
        if (!metadata.cron) {
          console.warn(`  [cron] scheduled_task ${task.id} has no cron expression`);
          continue;
        }

        const lastRun = this.userCronLastRuns.get(task.id) ?? null;

        if (shouldFire(metadata.cron, lastRun, now)) {
          await this.executeUserCron(task, settings);
        }
      }
    } catch (err) {
      console.error("  [cron] Error checking user crons:", err);
    }
  }

  /**
   * Execute a user-defined scheduled task by spawning a disposable agent.
   */
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
      const modelName = settings.user_cron_model;

      const systemPrompt =
        `You are Edda, executing a user-scheduled recurring task.` +
        ` Today is ${new Date().toISOString().split("T")[0]}.` +
        ` The user's timezone is ${settings.user_timezone}.` +
        (settings.user_display_name ? ` The user's name is ${settings.user_display_name}.` : "") +
        `\n\nScheduled task: ${task.content}` +
        `\nSchedule: ${metadata.cron_human ?? metadata.cron}` +
        `\nAction: ${metadata.action ?? task.content}` +
        `\n\nExecute this action using the available tools. Be concise and effective.`;

      const agent = await createEddaAgent();

      const result = await agent.invoke(
        {
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Execute the scheduled task now: ${metadata.action ?? task.content}`,
            },
          ],
        },
        {
          configurable: {
            thread_id: `user-cron-${taskId}-${new Date().toISOString().split("T")[0]}`,
            model: modelName,
          },
        },
      );

      const durationMs = Date.now() - startTime;

      const messages = (result?.messages ?? []) as Array<{
        role?: string;
        content?: string;
        _getType?: () => string;
      }>;
      const lastAssistantMsg = [...messages]
        .reverse()
        .find((m) => m.role === "assistant" || m._getType?.() === "ai");
      const outputSummary =
        typeof lastAssistantMsg?.content === "string"
          ? lastAssistantMsg.content.slice(0, 500)
          : `User cron ${taskId} completed`;

      await createAgentLog({
        skill: "user_cron",
        trigger: "user_cron",
        input_summary: `Scheduled task: ${task.content}`,
        output_summary: outputSummary,
        model: modelName,
        duration_ms: durationMs,
      });

      this.userCronLastRuns.set(taskId, new Date());

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

  /**
   * Parse a cron expression like "* /5 * * * *" into a millisecond interval.
   * Used only for the user cron check interval. Falls back to 5 minutes.
   */
  private parseCronToMs(cronExpr: string): number {
    const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    if (!cronExpr) return DEFAULT_INTERVAL_MS;

    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) return DEFAULT_INTERVAL_MS;

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
