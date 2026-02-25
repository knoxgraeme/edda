/**
 * Cron runner factory — local (node-cron) or langgraph (LangGraph Platform)
 */

import { getSettingsSync } from "@edda/db";

export interface CronRunner {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createCronRunner(): Promise<CronRunner> {
  const settings = getSettingsSync();

  if (settings.cron_runner === "platform") {
    const { LangGraphCronRunner } = await import("./langgraph.js");
    return new LangGraphCronRunner();
  }

  const { LocalCronRunner } = await import("./local.js");
  return new LocalCronRunner();
}
