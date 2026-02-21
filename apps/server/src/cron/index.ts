/**
 * Cron runner factory — standalone (node-cron) or platform (LangGraph)
 */

import { getSettingsSync } from "@edda/db";

export interface CronRunner {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createCronRunner(): Promise<CronRunner> {
  const settings = getSettingsSync();

  if (settings.cron_runner === "platform") {
    const { PlatformCronRunner } = await import("./platform.js");
    return new PlatformCronRunner();
  }

  const { StandaloneCronRunner } = await import("./standalone.js");
  return new StandaloneCronRunner();
}
