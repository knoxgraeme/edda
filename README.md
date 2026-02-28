<p align="center">
  <img src=".github/banner.png" alt="Edda" width="100%" />
</p>

> [!WARNING]
> **WIP — Untested in production, use with caution.**

**A self-hosted AI assistant that remembers you.**

Edda is an open-source personal assistant powered by LLMs. It extracts knowledge from your conversations, learns your preferences, remembers corrections, and runs scheduled tasks automatically. It gets better at helping you over time.

Self-hosted. Your infrastructure, your data.

## Why Edda?

Most AI assistants are stateless — every session starts from scratch. Edda maintains three layers of persistent memory:

- **Knowledge** — Facts, preferences, and patterns extracted from conversations, stored as vector embeddings for semantic search
- **History** — Full conversation threads preserved across sessions
- **Operating notes** — A living document (AGENTS.md) tracking communication style, quality standards, and past corrections

Corrections are durable. Tell Edda "don't summarize, give me the raw data" and that preference gets recorded, analyzed weekly, and written into its operating memory permanently.

## How it works

Edda runs a **unified multi-agent system**. Any agent can serve as the default conversational interface, run on a cron schedule, be triggered by another agent, or all three. A `default_agent` setting (default: `edda`) determines which agent handles direct chat.

```
You <──> Default agent (edda)
              |
              |── Digest ────── Daily summaries, weekly reflections
              |── Memory ────── Nightly knowledge extraction
              |── Maintenance ── Context refresh, schema evolution
              |
              |── Custom agents
```

### Built-in agents

| Agent | Skills | Schedules | Purpose |
|-------|--------|-----------|---------|
| **Edda** (default) | capture, recall, manage, admin | — | Conversational interface: save, search, organize, configure |
| **Digest** | daily_digest, weekly_reflect | 7am daily, 3am Sunday | Daily summaries, weekly pattern analysis, dropped thread detection |
| **Memory** | memory_extraction | 10pm nightly | Extract preferences, facts, and entities from conversations |
| **Maintenance** | context_refresh, type_evolution | 5am and 6am daily | Refresh operating memory, evolve data schemas |

All agents are configurable — change skills, schedules, models, or disable them. Any agent can be set as the default.

### Custom agents

Create agents through the chat interface or API:

> "Create an agent called researcher with the recall and capture skills, triggered on demand, with an ephemeral thread lifetime"

Each agent gets scoped tools (based on assigned skills), a configurable thread lifetime (`ephemeral`, `daily`, or `persistent`), and its own AGENTS.md operating memory with self-improvement built in.

## Notifications

- **Inbox** — Web UI notifications
- **Telegram** — Two-way messaging with proactive updates
- **Announcements** — Scheduled run outputs pushed to linked channels
- **Agent triggers** — One agent's output can trigger another agent

Reminders are also supported — time-based notifications (cron or interval) that fire without invoking an LLM.

## Memory system

### Storage

Every item gets a vector embedding. Items are typed (note, task, preference, learned_fact, pattern, etc.) with optional metadata. Search is semantic — matches on meaning, not keywords.

### Learning cycle

1. **During conversation** — `self_improvement` skill updates operating notes in real-time
2. **After conversation** — `memory_extraction` pulls out implicit knowledge and writes a session summary
3. **Nightly** — Memory agent processes any missed threads
4. **Weekly** — Digest agent reviews session summaries, identifies recurring corrections and preferences, updates AGENTS.md

### Deduplication

Automatic, based on semantic similarity:
- **95%+** — Existing item reinforced
- **85–95%** — Old item superseded
- **Below 85%** — New item created

### Entity tracking

Named entities (people, projects, companies, tools) are extracted automatically and linked to related items. Profiles are assembled on demand — always current.

## Architecture

```
edda/
  apps/server     — LangGraph agent backend (Node.js/TypeScript, port 8000)
  apps/web        — Next.js frontend (React 19, port 3000)
  packages/db     — Shared database client, queries, types, migrations
  packages/cli    — Interactive setup wizard
```

### Tech stack

- **Agent framework**: [LangGraph](https://langchain-ai.github.io/langgraphjs/) + [LangChain](https://js.langchain.com/)
- **LLM providers**: Anthropic (default), OpenAI, Google, Groq, Ollama, Mistral, AWS Bedrock
- **Embeddings**: Voyage AI (default), OpenAI, Google
- **Database**: PostgreSQL + [pgvector](https://github.com/pgvector/pgvector)
- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Scheduling**: node-cron with concurrency control

### Design decisions

- **Database-driven configuration** — LLM provider, model, and feature flags live in a `settings` table. Change models without redeploying.
- **Skill-based tool scoping** — Each skill declares required tools in SKILL.md frontmatter. Agents only access tools from their assigned skills.
- **Append-only migrations** — Schema changes are always new files, never edits to existing ones.
- **Three-layer system prompt** — Agent task description + operating memory (AGENTS.md) + deterministic system context. Each layer has distinct ownership and update cadence.

## Prerequisites

- **Node.js 20+**
- **pnpm**
- **PostgreSQL 14+** with [pgvector](https://github.com/pgvector/pgvector)
- API key for an LLM provider (Anthropic recommended)
- API key for an embedding provider (Voyage AI recommended)

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/knoxgraeme/edda.git
cd edda
pnpm install
```

### 2. Start Postgres

```bash
docker compose -f docker-compose.dev.yml up -d
```

PostgreSQL 16 with pgvector on `localhost:5432` (user: `edda`, password: `edda`, db: `edda`).

### 3. Configure

Interactive wizard (recommended):
```bash
pnpm init
```

Or manually:
```bash
cp .env.example .env
# Fill in DATABASE_URL and API keys
```

### 4. Migrate and seed

```bash
pnpm migrate
pnpm db:seed-settings
```

### 5. Run

```bash
pnpm dev
```

Server on port 8000, web UI on port 3000. Open [http://localhost:3000](http://localhost:3000).

## Configuration

### Required

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `LLM_PROVIDER` | `anthropic`, `openai`, `google`, `groq`, `ollama`, `mistral`, or `bedrock` |
| `LLM_MODEL` | Model identifier (e.g., `claude-sonnet-4-20250514`) |
| Provider API key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. |
| `EMBEDDING_PROVIDER` | `voyage`, `openai`, or `google` |
| Embedding API key | `VOYAGEAI_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` |

### Optional

| Variable | Description |
|----------|------------|
| `EDDA_PASSWORD` | Password-protect the web UI |
| `SEARCH_PROVIDER` | Web search: `tavily`, `brave`, `serper`, `serpapi` (+ API key) |
| `WOLFRAM_APP_ID` | WolframAlpha tool |
| `TELEGRAM_BOT_TOKEN` | Telegram integration (see below) |
| `INTERNAL_API_SECRET` | Backend auth (required for Telegram) |
| `LANGSMITH_API_KEY` | LangSmith tracing |
| `ALLOW_FILESYSTEM_ACCESS` | `true` + `FILESYSTEM_ROOT` for agent file access |
| `CORS_ORIGIN` | Backend CORS origin (default: `http://localhost:3000`) |

### Telegram setup

Two-way messaging from your phone, with per-topic agent routing.

**1. Create a bot** — [@BotFather](https://t.me/BotFather) → `/newbot`. To receive regular messages in group topics (not just commands), disable Group Privacy in Bot Settings.

**2. Set environment variables**

```
TELEGRAM_BOT_TOKEN=<your token>
INTERNAL_API_SECRET=<openssl rand -hex 32>
TELEGRAM_WEBHOOK_URL=https://your-server.railway.app/api/telegram/webhook
```

`TELEGRAM_WEBHOOK_URL` defaults to `http://localhost:8000/api/telegram/webhook` if omitted (use ngrok for local development).

**3. Approve users** — First-time users get a pairing request visible in the web UI. Approve to grant access.

**4. Bot commands**
- `/link <agent_name>` — Link a forum topic to an agent (DMs route to the default agent)
- `/unlink` — Remove the link
- `/status` — Show linked agent and recent activity

### MCP connections

Edda supports remote [MCP](https://modelcontextprotocol.io/) servers for additional tools. API keys are stored as env var references in the database (name only, not the secret). MCP auth env vars must start with `MCP_AUTH_`.

## Deploying to Railway

[Railway](https://railway.com) is the recommended deployment platform. Per-service `railway.toml` files are included.

### 1. Create project

New Railway project + **PostgreSQL** add-on (includes pgvector).

### 2. Set environment variables

```
DATABASE_URL          → (auto-populated by PostgreSQL add-on)
LLM_PROVIDER          → anthropic
LLM_MODEL             → claude-sonnet-4-20250514
ANTHROPIC_API_KEY     → sk-ant-...
EMBEDDING_PROVIDER    → voyage
VOYAGEAI_API_KEY      → ...
NODE_ENV              → production
EDDA_PASSWORD         → (set for public deployments)
INTERNAL_API_SECRET   → (openssl rand -hex 32)
CORS_ORIGIN           → https://your-web-domain.railway.app
```

### 3. Connect repo

Link your GitHub repo. Railway detects the monorepo and creates two services:

- **Server** (`apps/server/railway.toml`) — Builds DB + server, runs migrations on deploy, health check at `/health`
- **Web** (`apps/web/railway.toml`) — Builds DB + Next.js app, runs production server

Set `CORS_ORIGIN` to your web service URL. Migrations run automatically on every deploy.

## Scheduling

The cron runner reads `agent_schedules` and triggers agent runs via [node-cron](https://github.com/node-cron/node-cron). Each run creates a `task_run` record tracking duration, token usage, and output.

Concurrency capped at 3 parallel runs by default (`task_max_concurrency` setting). Schedules sync every 5 minutes — no restart needed for changes.

## Development

```bash
pnpm dev              # All services, watch mode
pnpm build            # Build all packages
pnpm test             # Vitest
pnpm type-check       # TypeScript
pnpm lint             # Lint
pnpm format           # Prettier
pnpm eval             # Eval suite (server)
```

### Project layout

```
apps/
  server/
    src/
      agent/           # Agent factory, tools, skill loading
      channels/        # Platform adapters (Telegram)
      server/          # HTTP server, API routes
      utils/           # Notifications, reminders, concurrency
    skills/            # SKILL.md definitions
    evals/             # Eval suite
  web/
    src/app/           # Next.js pages and API routes
    src/components/    # UI components

packages/
  db/
    src/               # Queries, types, connection pool
    migrations/        # SQL files (append-only)
  cli/src/             # Setup wizard
```

### Adding a tool

1. Create a file in `apps/server/src/agent/tools/` exporting a Zod schema
2. Use query functions from `@edda/db` (no raw SQL)
3. Add the tool name to the relevant skill's `allowed-tools` in SKILL.md
4. Export from `apps/server/src/agent/tools/index.ts`

### Adding a skill

1. Create `apps/server/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, `allowed-tools`)
2. Auto-seeded on startup

### Database migrations

Append-only:
```bash
touch packages/db/migrations/025_my_change.sql
pnpm migrate
```

## Contributing

Contributions welcome. Open an issue first to discuss.

## License

MIT
