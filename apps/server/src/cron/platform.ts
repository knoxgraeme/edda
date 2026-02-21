/**
 * Platform cron runner — delegates to LangGraph Platform cron API
 */

import type { CronRunner } from "./index.js";

export class PlatformCronRunner implements CronRunner {
  async start(): Promise<void> {
    // TODO: Sync crons to LangGraph Platform via its cron API
    console.log("  Platform cron runner started (placeholder)");
  }

  async stop(): Promise<void> {
    // TODO: Cleanup
  }
}
