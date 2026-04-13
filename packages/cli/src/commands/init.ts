/**
 * `edda init` — Interactive setup wizard
 *
 * Guides the user through:
 *  1. Database connection (Postgres URL) + connectivity check
 *  2. User identity (display name + timezone)
 *  3. LLM provider + API key + default model
 *  4. Embedding provider + API key
 *  5. Web search provider (optional)
 *  6. Chat channel setup (Telegram / Discord / Slack / skip)
 *  7. Optional web UI password
 *  8. Auto-generated internal secrets (INTERNAL_API_SECRET, EDDA_ENCRYPTION_KEY)
 *  9. Writes .env (merge-preserving — keeps unknown keys on re-run)
 * 10. Runs migrations
 * 11. Seeds settings and applies wizard choices
 *
 * Idempotent — safe to re-run to reconfigure.
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { randomBytes } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { LLM_PROVIDERS } from "@edda/db";
import { parseEnvFile, serializeEnvFile, type EnvSection } from "../lib/env.js";

// ─── Option lists ─────────────────────────────────────────────────────

interface ProviderMeta {
  label: string;
  hint?: string;
  defaultModel?: string;
  envVar?: string;
  needsKey?: boolean;
}

const LLM_PROVIDER_META: Record<(typeof LLM_PROVIDERS)[number], ProviderMeta> = {
  anthropic: {
    label: "Anthropic (Claude)",
    hint: "recommended",
    defaultModel: "claude-sonnet-4-20250514",
    envVar: "ANTHROPIC_API_KEY",
  },
  openai: {
    label: "OpenAI (GPT)",
    defaultModel: "gpt-4o",
    envVar: "OPENAI_API_KEY",
  },
  google: {
    label: "Google (Gemini)",
    defaultModel: "gemini-2.0-flash",
    envVar: "GOOGLE_API_KEY",
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    envVar: "GROQ_API_KEY",
  },
  ollama: {
    label: "Ollama (local)",
    defaultModel: "llama3.2",
    needsKey: false,
  },
  mistral: {
    label: "Mistral",
    defaultModel: "mistral-large-latest",
    envVar: "MISTRAL_API_KEY",
  },
  bedrock: {
    label: "AWS Bedrock",
    defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
    envVar: "AWS_ACCESS_KEY_ID",
  },
  xai: {
    label: "xAI (Grok)",
    defaultModel: "grok-3",
    envVar: "XAI_API_KEY",
  },
  deepseek: {
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    envVar: "DEEPSEEK_API_KEY",
  },
  cerebras: {
    label: "Cerebras",
    defaultModel: "llama-3.3-70b",
    envVar: "CEREBRAS_API_KEY",
  },
  fireworks: {
    label: "Fireworks AI",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    envVar: "FIREWORKS_API_KEY",
  },
  together: {
    label: "Together AI",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    envVar: "TOGETHER_AI_API_KEY",
  },
  azure_openai: {
    label: "Azure OpenAI",
    defaultModel: "gpt-4o",
    envVar: "AZURE_OPENAI_API_KEY",
  },
  openrouter: {
    label: "OpenRouter (100+ models)",
    defaultModel: "anthropic/claude-sonnet-4",
    envVar: "OPENROUTER_API_KEY",
  },
  minimax: {
    label: "Minimax",
    envVar: "MINIMAX_API_KEY",
  },
  moonshot: {
    label: "Moonshot",
    envVar: "MOONSHOT_API_KEY",
  },
  zhipuai: {
    label: "ZhipuAI",
    envVar: "ZHIPUAI_API_KEY",
  },
};

interface ProviderOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly envVar?: string;
}

const LLM_PROVIDER_OPTIONS: ProviderOption<(typeof LLM_PROVIDERS)[number]>[] = LLM_PROVIDERS.map(
  (value) => ({
    value,
    label: LLM_PROVIDER_META[value].label,
    hint: LLM_PROVIDER_META[value].hint,
  }),
);

type EmbeddingProviderValue = "voyage" | "openai" | "google";
const EMBEDDING_PROVIDERS: ProviderOption<EmbeddingProviderValue>[] = [
  { value: "voyage", label: "Voyage AI", hint: "recommended", envVar: "VOYAGE_API_KEY" },
  { value: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { value: "google", label: "Google", envVar: "GOOGLE_API_KEY" },
];

type SearchProviderValue = "none" | "duckduckgo" | "tavily" | "brave" | "serper" | "serpapi";
const SEARCH_PROVIDERS: ProviderOption<SearchProviderValue>[] = [
  { value: "none", label: "None (skip web search)" },
  { value: "duckduckgo", label: "DuckDuckGo", hint: "no API key required" },
  { value: "tavily", label: "Tavily", hint: "recommended", envVar: "TAVILY_API_KEY" },
  { value: "brave", label: "Brave Search", envVar: "BRAVE_API_KEY" },
  { value: "serper", label: "Serper", envVar: "SERPER_API_KEY" },
  { value: "serpapi", label: "SerpAPI", envVar: "SERPAPI_API_KEY" },
];

type ChannelChoice = "telegram" | "discord" | "slack" | "none";
const CHANNEL_OPTIONS: ProviderOption<ChannelChoice>[] = [
  { value: "telegram", label: "Telegram", hint: "recommended — works on mobile" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "none", label: "Skip — use the web UI or set up later" },
];

// ─── Wizard state ─────────────────────────────────────────────────────

interface WizardAnswers {
  databaseUrl: string;
  userDisplayName: string;
  userTimezone: string;
  llmProvider: (typeof LLM_PROVIDERS)[number];
  llmApiKey: string;
  llmModel: string;
  embeddingProvider: (typeof EMBEDDING_PROVIDERS)[number]["value"];
  embeddingApiKey: string;
  searchProvider: (typeof SEARCH_PROVIDERS)[number]["value"];
  searchApiKey: string;
  channel: ChannelChoice;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  discordBotToken: string;
  slackBotToken: string;
  slackAppToken: string;
  eddaPassword: string;
  internalApiSecret: string;
  eddaEncryptionKey: string;
}

// ─── Entry point ──────────────────────────────────────────────────────

export async function init(options: { nonInteractive?: boolean }) {
  p.intro(chalk.bold("🧠 Edda Setup Wizard"));

  if (options.nonInteractive) {
    p.log.warn("Non-interactive mode is not yet implemented.");
    p.outro("Run `edda init` without --non-interactive for the interactive wizard.");
    return;
  }

  // ── Step 1: Database ────────────────────────────────────────────────
  const databaseUrl = await p.text({
    message: "PostgreSQL connection URL",
    placeholder: "postgresql://user:pass@localhost:5432/edda",
    validate: (v) => {
      if (!v.startsWith("postgres")) return "Must be a PostgreSQL URL";
    },
  });
  if (p.isCancel(databaseUrl)) return handleCancel();

  const dbOk = await testDbConnection(databaseUrl);
  if (!dbOk) {
    const proceed = await p.confirm({
      message: "Could not connect. Continue anyway? (migration will likely fail)",
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) return handleCancel();
  }

  // ── Step 2: User identity ──────────────────────────────────────────
  const userDisplayName = await p.text({
    message: "Your name (how agents will address you)",
    placeholder: "Alex",
    validate: (v) => {
      if (!v.trim()) return "Please enter a name";
    },
  });
  if (p.isCancel(userDisplayName)) return handleCancel();

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const userTimezone = await p.text({
    message: "Your timezone (IANA)",
    initialValue: detectedTz,
    validate: (v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
      } catch {
        return "Not a valid IANA timezone (e.g. America/Los_Angeles)";
      }
    },
  });
  if (p.isCancel(userTimezone)) return handleCancel();

  // ── Step 3: LLM provider ───────────────────────────────────────────
  const llmProvider = (await p.select({
    message: "LLM provider",
    options: LLM_PROVIDER_OPTIONS,
  })) as (typeof LLM_PROVIDERS)[number] | symbol;
  if (p.isCancel(llmProvider)) return handleCancel();

  const llmMeta = LLM_PROVIDER_META[llmProvider];
  let llmApiKey = "";
  if (llmMeta.needsKey !== false && llmMeta.envVar) {
    const key = await p.password({ message: `${llmMeta.label} API key (${llmMeta.envVar})` });
    if (p.isCancel(key)) return handleCancel();
    llmApiKey = key;
  }

  const llmModel = await p.text({
    message: "Default model",
    initialValue: llmMeta.defaultModel ?? "",
    validate: (v) => {
      if (!v.trim()) return "Please enter a model name";
    },
  });
  if (p.isCancel(llmModel)) return handleCancel();

  // ── Step 4: Embedding provider ─────────────────────────────────────
  const embeddingProvider = (await p.select({
    message: "Embedding provider",
    options: EMBEDDING_PROVIDERS.map(({ value, label, hint }) => ({ value, label, hint })),
  })) as (typeof EMBEDDING_PROVIDERS)[number]["value"] | symbol;
  if (p.isCancel(embeddingProvider)) return handleCancel();

  const embeddingMeta = EMBEDDING_PROVIDERS.find((m) => m.value === embeddingProvider)!;
  const embeddingApiKey = await p.password({
    message: `${embeddingMeta.label} API key (${embeddingMeta.envVar})`,
  });
  if (p.isCancel(embeddingApiKey)) return handleCancel();

  // ── Step 5: Search provider (optional) ─────────────────────────────
  const searchProvider = (await p.select({
    message: "Web search provider (optional)",
    options: SEARCH_PROVIDERS.map(({ value, label, hint }) => ({ value, label, hint })),
  })) as (typeof SEARCH_PROVIDERS)[number]["value"] | symbol;
  if (p.isCancel(searchProvider)) return handleCancel();

  let searchApiKey = "";
  const searchMeta = SEARCH_PROVIDERS.find((m) => m.value === searchProvider);
  if (searchMeta && "envVar" in searchMeta && searchMeta.envVar) {
    const key = await p.password({ message: `${searchMeta.label} API key (${searchMeta.envVar})` });
    if (p.isCancel(key)) return handleCancel();
    searchApiKey = key;
  }

  // ── Step 6: Chat channel ──────────────────────────────────────────
  p.log.info(
    "Edda's primary chat interface is a messaging app. Pick one to set up now,\n" +
      "or skip and use the web UI / terminal commands.",
  );
  const channel = (await p.select({
    message: "Primary chat channel",
    options: CHANNEL_OPTIONS.map(({ value, label, hint }) => ({ value, label, hint })),
  })) as ChannelChoice | symbol;
  if (p.isCancel(channel)) return handleCancel();

  let telegramBotToken = "";
  let telegramWebhookSecret = "";
  let discordBotToken = "";
  let slackBotToken = "";
  let slackAppToken = "";

  if (channel === "telegram") {
    p.log.info(
      "1. Open Telegram and message @BotFather\n" +
        "2. Run /newbot and follow the prompts\n" +
        "3. Copy the bot token BotFather gives you",
    );
    const token = await p.password({ message: "Telegram bot token" });
    if (p.isCancel(token)) return handleCancel();
    telegramBotToken = token;
    telegramWebhookSecret = randomBytes(32).toString("hex");
  } else if (channel === "discord") {
    p.log.info(
      "1. Create an app at https://discord.com/developers/applications\n" +
        "2. Under 'Bot', copy the bot token",
    );
    const token = await p.password({ message: "Discord bot token" });
    if (p.isCancel(token)) return handleCancel();
    discordBotToken = token;
  } else if (channel === "slack") {
    p.log.info(
      "1. Create a Slack app (Socket Mode) at https://api.slack.com/apps\n" +
        "2. Copy both the bot token (xoxb-...) and app-level token (xapp-...)",
    );
    const bot = await p.password({ message: "Slack bot token (xoxb-...)" });
    if (p.isCancel(bot)) return handleCancel();
    slackBotToken = bot;
    const app = await p.password({ message: "Slack app token (xapp-...)" });
    if (p.isCancel(app)) return handleCancel();
    slackAppToken = app;
  }

  // ── Step 7: Optional Web UI password ──────────────────────────────
  const wantPassword = await p.confirm({
    message: "Protect the web UI with a password? (recommended if deployed publicly)",
    initialValue: false,
  });
  if (p.isCancel(wantPassword)) return handleCancel();

  let eddaPassword = "";
  if (wantPassword) {
    const pw = await p.password({
      message: "Web UI password",
      validate: (v) => {
        if (v.length < 8) return "Use at least 8 characters";
      },
    });
    if (p.isCancel(pw)) return handleCancel();
    eddaPassword = pw;
  }

  // ── Step 8: Auto-generate required secrets ─────────────────────────
  const internalApiSecret = randomBytes(32).toString("hex");
  const eddaEncryptionKey = randomBytes(32).toString("base64");

  const answers: WizardAnswers = {
    databaseUrl: databaseUrl as string,
    userDisplayName: (userDisplayName as string).trim(),
    userTimezone: (userTimezone as string).trim(),
    llmProvider: llmProvider as (typeof LLM_PROVIDERS)[number],
    llmApiKey,
    llmModel: (llmModel as string).trim(),
    embeddingProvider: embeddingProvider as (typeof EMBEDDING_PROVIDERS)[number]["value"],
    embeddingApiKey: embeddingApiKey as string,
    searchProvider: searchProvider as (typeof SEARCH_PROVIDERS)[number]["value"],
    searchApiKey,
    channel: channel as ChannelChoice,
    telegramBotToken,
    telegramWebhookSecret,
    discordBotToken,
    slackBotToken,
    slackAppToken,
    eddaPassword,
    internalApiSecret,
    eddaEncryptionKey,
  };

  // ── Step 9: Write .env (merge-preserving) ─────────────────────────
  const envPath = resolve(process.cwd(), ".env");
  const existing = existsSync(envPath)
    ? parseEnvFile(await readFile(envPath, "utf8"))
    : new Map<string, string>();

  const hadExisting = existing.size > 0;
  for (const [key, value] of buildEnvUpdates(answers)) {
    existing.set(key, value);
  }

  const envContent = serializeEnvFile(existing, ENV_SECTIONS, ENV_HEADER);
  await writeFile(envPath, envContent);
  p.log.success(hadExisting ? "Updated .env (unknown keys preserved)" : "Wrote .env");

  // Make the just-written values visible to the rest of this process
  // so @edda/db and other modules pick them up.
  for (const [key, value] of buildEnvUpdates(answers)) {
    process.env[key] = value;
  }

  // ── Step 10: Run migrations ──────────────────────────────────────
  const runMigrations = await p.confirm({
    message: "Run database migrations now?",
    initialValue: true,
  });

  if (!p.isCancel(runMigrations) && runMigrations) {
    const s = p.spinner();
    s.start("Running migrations...");
    try {
      const { runMigrations: migrate } = await import("@edda/db");
      await migrate();
      s.stop("Migrations complete");
    } catch (err) {
      s.stop("Migration failed");
      p.log.error(String(err));
    }
  }

  // ── Step 11: Seed settings + apply wizard choices ─────────────────
  const s = p.spinner();
  s.start("Seeding settings...");
  try {
    const { seedSettings, updateSettings } = await import("@edda/db");
    await seedSettings();

    const settingsUpdate: Record<string, unknown> = {
      llm_provider: answers.llmProvider,
      default_model: answers.llmModel,
      embedding_provider: answers.embeddingProvider,
      user_display_name: answers.userDisplayName,
      user_timezone: answers.userTimezone,
      setup_completed: true,
    };

    if (answers.searchProvider !== "none") {
      settingsUpdate.search_provider = answers.searchProvider;
      settingsUpdate.web_search_enabled = true;
    }

    await updateSettings(settingsUpdate);
    s.stop("Settings configured");
  } catch (err) {
    s.stop("Seed failed");
    p.log.error(String(err));
  }

  // ── Done ──────────────────────────────────────────────────────────
  p.outro(chalk.green("✅ Edda is configured!") + "\n\n" + buildNextSteps(answers));
}

// ─── Helpers ───────────────────────────────────────────────────────

function handleCancel() {
  p.cancel("Setup cancelled");
  process.exit(0);
}

async function testDbConnection(url: string): Promise<boolean> {
  process.env.DATABASE_URL = url;
  const s = p.spinner();
  s.start("Testing database connection...");
  try {
    const { getPool, closePool } = await import("@edda/db");
    await getPool().query("SELECT 1");
    // Drop the pool so subsequent steps can create a fresh one if needed.
    await closePool();
    s.stop("Database reachable");
    return true;
  } catch (err) {
    s.stop("Database unreachable");
    p.log.error(String((err as Error)?.message ?? err));
    try {
      const { closePool } = await import("@edda/db");
      await closePool();
    } catch {
      // best-effort cleanup
    }
    return false;
  }
}

function buildEnvUpdates(a: WizardAnswers): Map<string, string> {
  const updates = new Map<string, string>();

  updates.set("DATABASE_URL", a.databaseUrl);

  const llmEnvVar = LLM_PROVIDER_META[a.llmProvider].envVar;
  if (a.llmApiKey && llmEnvVar) updates.set(llmEnvVar, a.llmApiKey);

  const embeddingEnvVar = EMBEDDING_PROVIDERS.find((m) => m.value === a.embeddingProvider)?.envVar;
  if (a.embeddingApiKey && embeddingEnvVar) updates.set(embeddingEnvVar, a.embeddingApiKey);

  if (a.searchProvider !== "none") {
    updates.set("SEARCH_PROVIDER", a.searchProvider);
    const searchMeta = SEARCH_PROVIDERS.find((m) => m.value === a.searchProvider);
    if (searchMeta && "envVar" in searchMeta && searchMeta.envVar && a.searchApiKey) {
      updates.set(searchMeta.envVar, a.searchApiKey);
    }
  }

  updates.set("INTERNAL_API_SECRET", a.internalApiSecret);
  updates.set("EDDA_ENCRYPTION_KEY", a.eddaEncryptionKey);

  if (a.eddaPassword) updates.set("EDDA_PASSWORD", a.eddaPassword);

  if (a.channel === "telegram") {
    updates.set("TELEGRAM_BOT_TOKEN", a.telegramBotToken);
    updates.set("TELEGRAM_WEBHOOK_SECRET", a.telegramWebhookSecret);
  } else if (a.channel === "discord") {
    updates.set("DISCORD_BOT_TOKEN", a.discordBotToken);
  } else if (a.channel === "slack") {
    updates.set("SLACK_BOT_TOKEN", a.slackBotToken);
    updates.set("SLACK_APP_TOKEN", a.slackAppToken);
  }

  return updates;
}

const ENV_HEADER = `# Edda Environment Configuration
# Generated by \`edda init\`
# Re-running init preserves any keys not managed by the wizard.`;

const ALL_LLM_ENV_VARS = Array.from(
  new Set(
    LLM_PROVIDERS.map((p) => LLM_PROVIDER_META[p].envVar).filter((v): v is string => Boolean(v)),
  ),
);

const ALL_EMBEDDING_ENV_VARS = Array.from(
  new Set(EMBEDDING_PROVIDERS.map((m) => m.envVar).filter((v): v is string => Boolean(v))),
);

const ALL_SEARCH_ENV_VARS = SEARCH_PROVIDERS.filter((m): m is typeof m & { envVar: string } =>
  "envVar" in m && typeof m.envVar === "string",
).map((m) => m.envVar);

const ENV_SECTIONS: EnvSection[] = [
  { title: "Database", keys: ["DATABASE_URL"] },
  { title: "LLM Provider Keys", keys: ALL_LLM_ENV_VARS },
  { title: "Embedding Keys", keys: ALL_EMBEDDING_ENV_VARS },
  { title: "Web Search", keys: ["SEARCH_PROVIDER", ...ALL_SEARCH_ENV_VARS] },
  { title: "Internal Auth (required)", keys: ["INTERNAL_API_SECRET"] },
  { title: "Encryption (required)", keys: ["EDDA_ENCRYPTION_KEY"] },
  { title: "Web UI Auth (optional)", keys: ["EDDA_PASSWORD"] },
  {
    title: "Channels",
    keys: [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "TELEGRAM_WEBHOOK_URL",
      "DISCORD_BOT_TOKEN",
      "SLACK_BOT_TOKEN",
      "SLACK_APP_TOKEN",
    ],
  },
];

function buildNextSteps(a: WizardAnswers): string {
  const lines: string[] = [`  ${chalk.dim("Start the server:")}  pnpm dev`];

  if (a.channel === "telegram") {
    lines.push(
      "",
      `  ${chalk.bold("Telegram setup:")}`,
      `  ${chalk.dim("1.")} After the server starts, register your webhook:`,
      `     ${chalk.cyan("curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook \\")}`,
      `          ${chalk.cyan('-d "url=<PUBLIC_URL>/api/channels/telegram/webhook" \\')}`,
      `          ${chalk.cyan(`-d "secret_token=${a.telegramWebhookSecret}"`)}`,
      `  ${chalk.dim("2.")} Message your bot to pair your account.`,
    );
  } else if (a.channel === "discord") {
    lines.push(
      "",
      `  ${chalk.bold("Discord setup:")}`,
      `  ${chalk.dim("1.")} Invite your bot to a server with the 'bot' and 'applications.commands' scopes.`,
      `  ${chalk.dim("2.")} Use /edda link in a channel to pair.`,
    );
  } else if (a.channel === "slack") {
    lines.push(
      "",
      `  ${chalk.bold("Slack setup:")}`,
      `  ${chalk.dim("1.")} Install the app to your workspace.`,
      `  ${chalk.dim("2.")} Use /edda link in a channel to pair.`,
    );
  } else {
    lines.push(
      `  ${chalk.dim("Open the web UI:")}   http://localhost:3000`,
      `  ${chalk.dim("Or set up a chat channel later with:")}  ${chalk.cyan("edda init")}`,
    );
  }

  return lines.join("\n");
}
