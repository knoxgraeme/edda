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
import { createCronRunner } from "./cron.js";
import { setAgent, startHealthServer } from "./server/index.js";
import { initTelegram, registerWebhook } from "./channels/telegram.js";
import { logger } from "./logger.js";

async function main() {
  const log = logger.child({ module: "startup" });
  log.info("Edda starting");

  // 1. Load settings (must happen before anything else)
  const settings = await refreshSettings();
  log.info({ provider: settings.llm_provider, model: settings.default_model }, "Settings loaded");

  // 2. Seed system skills
  await seedSkills();
  log.info("Skills seeded");

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
  log.info({ agent: agentRow.name }, "Agent ready");

  // 4. Bootstrap AGENTS.md if empty (first boot only)
  const latestMd = await getLatestAgentsMd();
  if (!latestMd?.content?.trim()) {
    log.info("AGENTS.md empty — running initial context refresh");
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
      log.warn({ err }, "Initial context refresh failed (will retry on cron)");
    }
  }

  // 5. Start cron runner
  const cronRunner = await createCronRunner();
  await cronRunner.start();
  log.info("Cron runner started");

  // 6. Health endpoint
  const port = parseInt(process.env.PORT ?? "8000", 10);
  await startHealthServer(port);
  log.info({ port, url: `http://localhost:${port}/api/health` }, "Health server started");

  // 7. Telegram bot (optional — only if TELEGRAM_BOT_TOKEN is set)
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    const apiSecret = process.env.INTERNAL_API_SECRET;
    if (!apiSecret) {
      throw new Error(
        "INTERNAL_API_SECRET is required when TELEGRAM_BOT_TOKEN is set. " +
        "It is used to authenticate both internal API calls and Telegram webhook requests. " +
        "Generate one with: openssl rand -hex 32"
      );
    }

    await initTelegram(telegramToken);

    const webhookUrl =
      process.env.TELEGRAM_WEBHOOK_URL ?? `http://localhost:${port}/api/telegram/webhook`;
    try {
      await registerWebhook(webhookUrl, apiSecret);
    } catch (err) {
      log.warn({ err }, "Telegram webhook registration failed (will work with manual setup)");
    }
  }

  log.info("Edda ready");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
