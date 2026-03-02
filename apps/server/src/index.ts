/**
 * @edda/server — Entry point
 *
 * Starts the LangGraph server with the Edda agent,
 * initializes cron runner, and serves the health endpoint.
 */

import {
  refreshSettings,
  getLatestAgentsMd,
  getAgentByName,
  runMigrations,
  seedSettings,
} from "@edda/db";
import { seedSkills } from "./agent/seed-skills.js";
import { buildAgent, resolveThreadId } from "./agent/build-agent.js";
import { resolveRetrievalContext } from "./agent/tool-helpers.js";
import { createCronRunner } from "./cron.js";
import { setAgent } from "./agent/agent-cache.js";
import { startHealthServer } from "./server/index.js";
import { TelegramAdapter } from "./channels/telegram.js";
import { DiscordAdapter } from "./channels/discord.js";
import { SlackAdapter } from "./channels/slack.js";
import { closeMCPClients } from "./mcp/client.js";
import { logger } from "./logger.js";
import { patchAnthropicToolSchemas } from "./agent/patch-anthropic-schemas.js";

async function main() {
  const log = logger.child({ module: "startup" });
  log.info("Edda starting");

  // 0. Start health server FIRST — bind port before any DB/network calls
  //    so orchestrators (Railway, Fly) see us as alive immediately.
  const port = parseInt(process.env.PORT ?? "8000", 10);
  await startHealthServer(port);
  log.info({ port, url: `http://localhost:${port}/api/health` }, "Health server started");

  // 1. Run migrations + seed (previously chained in startCommand before server)
  await runMigrations();
  await seedSettings();
  log.info("Database migrations and seed complete");

  // 2. Patch Anthropic tool schema serialization — ensures all tools have type: "object"
  patchAnthropicToolSchemas();

  // 3. Load settings
  const settings = await refreshSettings();
  log.info({ provider: settings.llm_provider, model: settings.default_model }, "Settings loaded");

  // 4. Seed system skills
  await seedSkills();
  log.info("Skills seeded");

  // 5. Create agent — default_agent from settings (any agent can be the default)
  const agentRow = await getAgentByName(settings.default_agent);
  if (!agentRow) {
    throw new Error(
      `Default agent "${settings.default_agent}" not found in database. ` +
        `Check settings.default_agent and ensure the agent exists.`,
    );
  }
  if (!agentRow.enabled) {
    throw new Error(
      `Default agent "${settings.default_agent}" is disabled. ` +
        `Enable it or change settings.default_agent.`,
    );
  }
  const agent = await buildAgent(agentRow);
  setAgent(agent, {
    agentName: agentRow.name,
    agentRow,
    retrievalContext: resolveRetrievalContext(agentRow.metadata, agentRow.name),
  });
  log.info({ agent: agentRow.name }, "Agent ready");

  // 6. Bootstrap AGENTS.md if empty (first boot only)
  const latestMd = await getLatestAgentsMd();
  if (!latestMd?.content?.trim()) {
    log.info("AGENTS.md empty — running initial context refresh");
    try {
      const maintenanceDef = await getAgentByName("maintenance");
      if (maintenanceDef) {
        const crAgent = await buildAgent(maintenanceDef);
        const threadId = resolveThreadId(maintenanceDef, undefined, {
          timezone: settings.user_timezone,
        });
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

  // 7. Start cron runner
  const cronRunner = await createCronRunner();
  await cronRunner.start();
  log.info("Cron runner started");

  // 8. Channel adapters — Telegram bot (optional — only if TELEGRAM_BOT_TOKEN is set)
  let telegram: TelegramAdapter | null = null;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error(
        "TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_BOT_TOKEN is set. " +
          "Use a dedicated secret for Telegram webhook verification. " +
          "Generate one with: openssl rand -hex 32",
      );
    }

    telegram = new TelegramAdapter(telegramToken, { webhookSecret });
    await telegram.init();

    const webhookUrl =
      process.env.TELEGRAM_WEBHOOK_URL ?? `http://localhost:${port}/api/channels/telegram/webhook`;
    try {
      await telegram.registerWebhook(webhookUrl);
    } catch (err) {
      log.warn({ err }, "Telegram webhook registration failed (will work with manual setup)");
    }
  }

  // 9. Channel adapters — Discord bot (optional — only if DISCORD_BOT_TOKEN is set)
  let discord: DiscordAdapter | null = null;
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  if (discordToken) {
    discord = new DiscordAdapter(discordToken);
    await discord.init();
  }

  // 10. Channel adapters — Slack bot (optional — only if both SLACK_BOT_TOKEN and SLACK_APP_TOKEN are set)
  let slack: SlackAdapter | null = null;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;
  if (slackBotToken && slackAppToken) {
    slack = new SlackAdapter(slackBotToken, slackAppToken);
    await slack.init();
  } else if (slackBotToken || slackAppToken) {
    log.warn("Both SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required for Slack — skipping");
  }

  // 11. Shutdown handler
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down");
    try {
      if (telegram) await telegram.shutdown();
      if (discord) await discord.shutdown();
      if (slack) await slack.shutdown();
      await cronRunner.stop();
      await closeMCPClients();
    } catch (err) {
      log.error({ err }, "Shutdown cleanup failed");
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  log.info("Edda ready");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
