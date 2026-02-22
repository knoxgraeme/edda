/**
 * @edda/server — Entry point
 *
 * Starts the LangGraph server with the Edda agent,
 * initializes cron runner, and serves the health endpoint.
 */

import { refreshSettings, getLatestAgentsMd } from "@edda/db";
import { createEddaAgent } from "./agent/index.js";
import { runContextRefreshAgent } from "./agent/generate-agents-md.js";
import { createCronRunner } from "./cron/index.js";
import { setAgent, startHealthServer } from "./server/health.js";

async function main() {
  console.log("🧠 Edda starting...");

  // 1. Load settings (must happen before anything else)
  const settings = await refreshSettings();
  console.log(`  Provider: ${settings.llm_provider} / ${settings.default_model}`);

  // 2. Create agent
  const agent = await createEddaAgent();
  setAgent(agent);
  console.log("  Agent ready");

  // 3. Bootstrap AGENTS.md if empty (first boot only)
  const latestMd = await getLatestAgentsMd();
  if (!latestMd?.content?.trim()) {
    console.log("  AGENTS.md empty — running initial context refresh...");
    await runContextRefreshAgent().catch((err: unknown) => {
      console.warn("  Initial context refresh failed (will retry on cron):", err);
    });
  }

  // 4. Start cron runner
  const cronRunner = await createCronRunner();
  await cronRunner.start();
  console.log(`  Cron runner: ${settings.cron_runner}`);

  // 5. Health endpoint
  const port = parseInt(process.env.PORT ?? "8000", 10);
  await startHealthServer(port);
  console.log(`  Health: http://localhost:${port}/api/health`);

  console.log("🧠 Edda ready.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
