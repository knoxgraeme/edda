/**
 * LangGraph cron runner — delegates to LangGraph Platform cron API
 */

import type { CronRunner } from "./index.js";

export class LangGraphCronRunner implements CronRunner {
  async start(): Promise<void> {
    // TODO: Sync crons to LangGraph Platform via its cron API
    console.log("  LangGraph cron runner started (placeholder)");
  }

  async stop(): Promise<void> {
    // TODO: Cleanup
  }
}
