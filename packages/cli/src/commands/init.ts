/**
 * `edda init` — Interactive setup wizard
 *
 * Guides the user through:
 * 1. Database connection (Postgres URL)
 * 2. LLM provider + API key
 * 3. Embedding provider + API key
 * 4. Search provider (optional)
 * 5. Cron runner selection
 * 6. Writes .env file
 * 7. Runs migrations
 * 8. Seeds default settings
 *
 * Idempotent — safe to re-run to reconfigure.
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface WizardAnswers {
  databaseUrl: string;
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  embeddingProvider: string;
  embeddingApiKey: string;
  searchProvider: string;
  searchApiKey: string;
  cronRunner: string;
}

const LLM_PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)", hint: "recommended" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "google", label: "Google (Gemini)" },
  { value: "groq", label: "Groq" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "mistral", label: "Mistral" },
  { value: "bedrock", label: "AWS Bedrock" },
];

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3.2",
  mistral: "mistral-large-latest",
  bedrock: "anthropic.claude-sonnet-4-20250514-v1:0",
};

const EMBEDDING_PROVIDERS = [
  { value: "voyage", label: "Voyage AI", hint: "recommended" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
];

const SEARCH_PROVIDERS = [
  { value: "none", label: "None (skip web search)" },
  { value: "tavily", label: "Tavily", hint: "recommended" },
  { value: "brave", label: "Brave Search" },
  { value: "serper", label: "Serper" },
  { value: "serpapi", label: "SerpAPI" },
];

const CRON_RUNNERS = [
  { value: "standalone", label: "Standalone (node-cron)", hint: "self-hosted" },
  { value: "platform", label: "LangGraph Platform", hint: "managed" },
];

export async function init(options: { nonInteractive?: boolean }) {
  p.intro(chalk.bold("🧠 Edda Setup Wizard"));

  if (options.nonInteractive) {
    p.log.info("Non-interactive mode: reading from environment variables");
    // TODO: Read all values from process.env and skip prompts
    p.outro("Non-interactive setup not yet implemented");
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

  // ── Step 2: LLM Provider ───────────────────────────────────────────
  const llmProvider = await p.select({
    message: "LLM provider",
    options: LLM_PROVIDERS,
  });

  if (p.isCancel(llmProvider)) return handleCancel();

  const needsLlmKey = llmProvider !== "ollama";
  let llmApiKey = "";

  if (needsLlmKey) {
    const key = await p.password({
      message: `${llmProvider} API key`,
    });
    if (p.isCancel(key)) return handleCancel();
    llmApiKey = key;
  }

  const llmModel = await p.text({
    message: "Default model",
    initialValue: DEFAULT_MODELS[llmProvider as string] ?? "",
  });

  if (p.isCancel(llmModel)) return handleCancel();

  // ── Step 3: Embedding Provider ─────────────────────────────────────
  const embeddingProvider = await p.select({
    message: "Embedding provider",
    options: EMBEDDING_PROVIDERS,
  });

  if (p.isCancel(embeddingProvider)) return handleCancel();

  const embeddingApiKey = await p.password({
    message: `${embeddingProvider} API key for embeddings`,
  });

  if (p.isCancel(embeddingApiKey)) return handleCancel();

  // ── Step 4: Search Provider (optional) ─────────────────────────────
  const searchProvider = await p.select({
    message: "Web search provider (optional)",
    options: SEARCH_PROVIDERS,
  });

  if (p.isCancel(searchProvider)) return handleCancel();

  let searchApiKey = "";
  if (searchProvider !== "none") {
    const key = await p.password({
      message: `${searchProvider} API key`,
    });
    if (p.isCancel(key)) return handleCancel();
    searchApiKey = key;
  }

  // ── Step 5: Cron Runner ────────────────────────────────────────────
  const cronRunner = await p.select({
    message: "Cron runner",
    options: CRON_RUNNERS,
  });

  if (p.isCancel(cronRunner)) return handleCancel();

  // ── Step 6: Write .env ─────────────────────────────────────────────
  const answers: WizardAnswers = {
    databaseUrl: databaseUrl as string,
    llmProvider: llmProvider as string,
    llmApiKey,
    llmModel: llmModel as string,
    embeddingProvider: embeddingProvider as string,
    embeddingApiKey: embeddingApiKey as string,
    searchProvider: searchProvider as string,
    searchApiKey,
    cronRunner: cronRunner as string,
  };

  const envPath = resolve(process.cwd(), ".env");
  const envContent = buildEnvFile(answers);

  if (existsSync(envPath)) {
    const overwrite = await p.confirm({
      message: ".env file already exists. Overwrite?",
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.log.info("Skipping .env write");
    } else {
      await writeFile(envPath, envContent);
      p.log.success("Wrote .env");
    }
  } else {
    await writeFile(envPath, envContent);
    p.log.success("Wrote .env");
  }

  // ── Step 7: Run migrations ─────────────────────────────────────────
  const runMigrations = await p.confirm({
    message: "Run database migrations now?",
    initialValue: true,
  });

  if (!p.isCancel(runMigrations) && runMigrations) {
    const s = p.spinner();
    s.start("Running migrations...");
    try {
      // Dynamic import to pick up the just-written .env
      const { runMigrations: migrate } = await import("@edda/db");
      await migrate();
      s.stop("Migrations complete");
    } catch (err) {
      s.stop("Migration failed");
      p.log.error(String(err));
    }
  }

  // ── Step 8: Seed settings ──────────────────────────────────────────
  const s = p.spinner();
  s.start("Seeding default settings...");
  try {
    const { seedSettings } = await import("@edda/db");
    await seedSettings();
    s.stop("Settings seeded");
  } catch (err) {
    s.stop("Seed failed");
    p.log.error(String(err));
  }

  // ── Done ───────────────────────────────────────────────────────────
  p.outro(
    chalk.green("✅ Edda is configured!") +
      "\n\n" +
      `  ${chalk.dim("Start the server:")}  pnpm dev\n` +
      `  ${chalk.dim("Open the UI:")}       http://localhost:3000\n`,
  );
}

function handleCancel() {
  p.cancel("Setup cancelled");
  process.exit(0);
}

function buildEnvFile(a: WizardAnswers): string {
  const lines: string[] = [
    "# Edda Environment Configuration",
    "# Generated by `edda init`",
    "",
    "# Database",
    `DATABASE_URL="${a.databaseUrl}"`,
    "",
    "# LLM",
    `LLM_PROVIDER=${a.llmProvider}`,
    `LLM_MODEL=${a.llmModel}`,
  ];

  // Provider-specific API key env var
  const keyMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
    mistral: "MISTRAL_API_KEY",
  };

  if (a.llmApiKey && keyMap[a.llmProvider]) {
    lines.push(`${keyMap[a.llmProvider]}="${a.llmApiKey}"`);
  }

  lines.push("", "# Embeddings", `EMBEDDING_PROVIDER=${a.embeddingProvider}`);

  const embKeyMap: Record<string, string> = {
    voyage: "VOYAGE_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
  };

  if (a.embeddingApiKey && embKeyMap[a.embeddingProvider]) {
    lines.push(`${embKeyMap[a.embeddingProvider]}="${a.embeddingApiKey}"`);
  }

  if (a.searchProvider !== "none") {
    const searchKeyMap: Record<string, string> = {
      tavily: "TAVILY_API_KEY",
      brave: "BRAVE_API_KEY",
      serper: "SERPER_API_KEY",
      serpapi: "SERPAPI_API_KEY",
    };
    lines.push(
      "",
      "# Web Search",
      `SEARCH_PROVIDER=${a.searchProvider}`,
      `${searchKeyMap[a.searchProvider]}="${a.searchApiKey}"`,
    );
  }

  lines.push("", "# Cron", `CRON_RUNNER=${a.cronRunner}`, "");

  return lines.join("\n");
}
