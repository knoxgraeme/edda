/**
 * LangGraph cron runner — delegates to LangGraph Platform cron API
 */

import { getLogger } from "../logger.js";
import type { CronRunner } from "./index.js";

export class LangGraphCronRunner implements CronRunner {
  async start(): Promise<void> {
    // TODO: Sync crons to LangGraph Platform via its cron API
    getLogger().info("LangGraph cron runner started (placeholder)");
  }

  async stop(): Promise<void> {
    // TODO: Cleanup
  }
}
