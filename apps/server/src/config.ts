import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

  // Provider API keys (optional — depends on selected provider in DB settings)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),

  // Embeddings
  VOYAGE_API_KEY: z.string().optional(),

  // Web search (optional)
  SEARCH_PROVIDER: z.enum(['tavily', 'brave', 'serper', 'serpapi', 'duckduckgo']).optional(),
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),

  // Community tools (optional)
  WOLFRAM_APP_ID: z.string().min(1).optional(),

  // LangSmith (optional)
  LANGSMITH_TRACING: z.enum(["true", "false"]).optional(),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().optional(),
  LANGCHAIN_CALLBACKS_BACKGROUND: z.enum(["true", "false"]).optional(),
  LANGSMITH_TRACING_SAMPLING_RATE: z.coerce.number().min(0).max(1).optional(),

  // Auth
  EDDA_PASSWORD: z.string().optional(),
  INTERNAL_API_SECRET: z.string().min(1, 'INTERNAL_API_SECRET is required — generate one with: openssl rand -hex 32'),

  // OAuth encryption + callback
  EDDA_ENCRYPTION_KEY: z.string().optional(),
  EDDA_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Telegram (optional — omit to disable)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),

  // Discord (optional — omit to disable)
  DISCORD_BOT_TOKEN: z.string().optional(),

  // Slack (optional — omit to disable; both tokens required)
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),

  // Sandbox
  SANDBOX_TIMEOUT_MS: z.coerce.number().optional().default(30000),

  // Logging
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  // Server
  PORT: z.coerce.number().int().positive().default(8000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).superRefine((env, ctx) => {
  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TELEGRAM_WEBHOOK_SECRET'],
      message: 'TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_BOT_TOKEN is set',
    });
  }
  if (env.LANGSMITH_TRACING === "true" && !env.LANGSMITH_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LANGSMITH_API_KEY"],
      message: "LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true",
    });
  }
});

export type EnvConfig = z.infer<typeof envSchema>;

let _config: EnvConfig | null = null;

export function loadConfig(): EnvConfig {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  _config = result.data;
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
