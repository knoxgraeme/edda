/**
 * Standalone cron runner — uses node-cron for scheduling
 * Self-hosted, no platform dependency.
 */

import type { CronRunner } from "./index.js";

export class StandaloneCronRunner implements CronRunner {
  async start(): Promise<void> {
    // TODO: Register system crons (daily_digest, weekly_reflect, memory_extraction)
    // TODO: Register user-defined crons from scheduled_task items
    // See cortex-spec-v4.md § Cron System for full implementation
    console.log("  Standalone cron runner started (placeholder)");
  }

  async stop(): Promise<void> {
    // TODO: Stop all cron jobs
  }
}
