/**
 * @edda/server — Entry point
 *
 * Starts the LangGraph server with the Edda agent,
 * initializes cron runner, and serves the health endpoint.
 */

import { refreshSettings } from "@edda/db";
import { seedSkills } from "./agent/seed-skills.js";
import { createEddaAgent } from "./agent/index.js";
import { createCronRunner } from "./cron/index.js";
import { setAgent, startHealthServer } from "./server/health.js";

async function main() {
  console.log("🧠 Edda starting...");

  // 1. Load settings (must happen before anything else)
  const settings = await refreshSettings();
  console.log(`  Provider: ${settings.llm_provider} / ${settings.default_model}`);

  // 2. Seed system skills
  await seedSkills();
  console.log("  Skills seeded");

  // 3. Create agent
  const agent = await createEddaAgent();
  setAgent(agent);
  console.log("  Agent ready");

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
