/**
 * @edda/server — Entry point
 *
 * Starts the LangGraph server with the Edda agent,
 * initializes cron runner, and serves the health endpoint.
 */

import { refreshSettings, getLatestAgentsMd, getAgentByName } from "@edda/db";
import { seedSkills } from "./agent/seed-skills.js";
import { buildAgent, resolveThreadId } from "./agent/build-agent.js";
import { resolveRetrievalContext } from "./agent/tool-helpers.js";
import { createCronRunner } from "./cron/index.js";
import { setAgent, startHealthServer } from "./server/index.js";
import { initTelegram, registerWebhook } from "./channels/telegram.js";

async function main() {
  console.log("🧠 Edda starting...");

  // 1. Load settings (must happen before anything else)
  const settings = await refreshSettings();
  console.log(`  Provider: ${settings.llm_provider} / ${settings.default_model}`);

  // 2. Seed system skills
  await seedSkills();
  console.log("  Skills seeded");

  // 3. Create agent — default_agent from settings (any agent can be the default)
  const agentRow = await getAgentByName(settings.default_agent);
  if (!agentRow) {
    throw new Error(
      `Default agent "${settings.default_agent}" not found in database. ` +
        `Check settings.default_agent and ensure the agent exists.`,
    );
  }
  const agent = await buildAgent(agentRow);
  setAgent(agent, {
    agentName: agentRow.name,
    retrievalContext: resolveRetrievalContext(agentRow.metadata, agentRow.name),
  });
  console.log(`  Agent ready (${agentRow.name})`);

  // 4. Bootstrap AGENTS.md if empty (first boot only)
  const latestMd = await getLatestAgentsMd();
  if (!latestMd?.content?.trim()) {
    console.log("  AGENTS.md empty — running initial context refresh...");
    try {
      const maintenanceDef = await getAgentByName("maintenance");
      if (maintenanceDef) {
        const crAgent = await buildAgent(maintenanceDef);
        const threadId = resolveThreadId(maintenanceDef);
        await crAgent.invoke(
          {
            messages: [
              {
                role: "user",
                content:
                  "This is the first boot. Check for context changes and create the initial AGENTS.md document.",
              },
            ],
          },
          { configurable: { thread_id: threadId, agent_name: "maintenance" } },
        );
      }
    } catch (err: unknown) {
      console.warn("  Initial context refresh failed (will retry on cron):", err);
    }
  }

  // 5. Start cron runner
  const cronRunner = await createCronRunner();
  await cronRunner.start();
  console.log(`  Cron runner: ${settings.cron_runner}`);

  // 6. Health endpoint
  const port = parseInt(process.env.PORT ?? "8000", 10);
  await startHealthServer(port);
  console.log(`  Health: http://localhost:${port}/api/health`);

  // 7. Telegram bot (optional — only if TELEGRAM_BOT_TOKEN is set)
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    initTelegram(telegramToken);

    // TELEGRAM_WEBHOOK_URL must point at the server (port 8000), not the web app (port 3000)
    const webhookUrl =
      process.env.TELEGRAM_WEBHOOK_URL ?? `http://localhost:${port}/api/telegram/webhook`;
    try {
      await registerWebhook(webhookUrl, process.env.TELEGRAM_WEBHOOK_SECRET);
    } catch (err) {
      console.warn("  Telegram webhook registration failed (will work with manual setup):", err);
    }
  }

  console.log("🧠 Edda ready.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
