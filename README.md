<p align="center">
  <img src=".github/banner.jpg" alt="Edda" width="100%" />
</p>

> [!WARNING]
> **WIP — Untested in production, use with caution.**

**A self-hosted AI assistant that actually remembers you.**

Most AI assistants forget everything the moment you close the tab. Edda doesn't. It extracts knowledge from your conversations, learns your preferences, remembers your corrections, and runs background tasks while you sleep. Over time it builds a genuine understanding of how you work and what you care about.

It's open source, runs on your own infrastructure, and you own all your data.

## Why Edda?

There's a gap between what AI assistants *could* be and what they actually are. You shouldn't have to re-explain your preferences every session. You shouldn't have to manually organize everything you tell it. And you definitely shouldn't need to babysit it — it should be working for you in the background, not just when you're staring at a chat window.

Edda closes that gap with three layers of memory:

- **Knowledge** — Facts, preferences, and patterns pulled from your conversations automatically, stored as vector embeddings so it can find things by meaning, not just keywords
- **History** — Your full conversation threads, preserved across sessions
- **Operating notes** — A living document where Edda tracks how *you* like to be helped: your communication style, your quality standards, things you've corrected it on

That last one is the important bit. When you tell Edda "stop summarizing, just give me the raw data" — that doesn't just change the current response. It gets recorded, analyzed at the end of the week, and written into Edda's operating memory. Next week, it won't summarize. It learned.

## How it works

Under the hood, Edda runs a **multi-agent system**. There's one agent you talk to directly (the default is called `edda`), and a handful of specialized agents that do work in the background on cron schedules:

```
You <──> Edda (your main agent)
              |
              |── Digest ────── Daily summaries, weekly reflections
              |── Memory ────── Nightly knowledge extraction
              |── Maintenance ── Context refresh, schema evolution
              |
              |── Your custom agents (if you want them)
```

### Your main agent

The default agent comes with four skill sets out of the box:

- **Capture** — Save notes, tasks, bookmarks, whatever. Structured or freeform.
- **Recall** — Semantic search across everything you've ever stored
- **Manage** — Update, archive, reorganize your stuff
- **Admin** — Create new agents, set up schedules, tweak the system

### Background agents

These run on their own, no interaction needed:

| Agent | When it runs | What it does |
|-------|-------------|--------------|
| **Digest** | 7am daily, 3am Sunday | Summarizes your day. On Sundays, looks at the whole week — finds patterns, flags dropped threads, spots things you might've forgotten about |
| **Memory** | 10pm nightly | Goes through your conversations and pulls out preferences, facts, and entities you mentioned. You don't have to explicitly "save" things |
| **Maintenance** | 5am and 6am daily | Refreshes the operating memory, evolves your data schemas as usage patterns change |

All schedules are configurable. You can disable any of them, change the times, or add your own.

### Make your own agents

Agents live in the database and you can create them just by asking:

> "Create an agent called researcher with the recall and capture skills, triggered on demand, with an ephemeral thread lifetime"

Every agent you create gets:
- **Skills** — Pick from the available skill modules (capture, recall, manage, admin, reminders, etc.)
- **Scoped tools** — An agent only sees the tools its skills need. No accidental access to things it shouldn't touch
- **Thread lifetime** — `ephemeral` (clean slate every run), `daily` (shared thread per day), or `persistent` (remembers everything forever)
- **Its own memory** — Every agent gets a separate AGENTS.md and the self-improvement skill, so it learns independently

## Staying in touch

Edda doesn't just wait for you to open the web UI. It has a proper notification system:

- **Inbox** — Notifications sitting in the web UI for when you check in
- **Telegram** — Two-way messaging. Send Edda messages from your phone, get proactive updates back
- **Announcements** — After a scheduled run finishes, results get pushed to whatever channels you've linked (Telegram groups, topic threads, etc.)
- **Agent triggers** — One agent's output can kick off another agent. The daily digest, for example, creates an inbox notification *and* pings the main agent so it's ready to discuss the summary with you

### Reminders

Sometimes you just need a nudge at 3pm on Thursday. Reminders fire without burning LLM tokens — they're pure scheduled notifications. They support cron expressions (`0 15 * * 4`) or plain intervals ("every 2 hours"), and they handle recurrence automatically.

## The memory system (the interesting part)

### How things get stored

Every piece of information becomes an **item** with a vector embedding. Items have types — note, task, preference, learned_fact, pattern, and more — plus optional metadata. When you search, Edda matches on meaning, not keywords. Ask for "that restaurant Sarah recommended" and it'll find it even if you never used the word "restaurant" when you saved it.

### How Edda actually learns

This is the cycle that makes it work:

1. **During conversation** — When Edda notices a pattern or preference, the `self_improvement` skill lets it update its operating notes right away
2. **After conversation** — `memory_extraction` runs and pulls out implicit stuff you didn't explicitly ask it to save: preferences, facts about people, behavioral patterns. It also writes a session summary — a retrospective of what went well and what you corrected
3. **Every night** — The memory agent sweeps through any threads that got missed during the day
4. **Every week** — The digest agent reads all the session summaries from the past seven days. It looks for patterns: "The user corrected me three times this week about being too verbose." Then it makes targeted updates to AGENTS.md. That's how one-off corrections become permanent behavior changes

### Keeping things clean

Items deduplicate automatically based on semantic similarity:
- **95%+ match** — It's basically the same thing. The existing item gets reinforced (updated timestamp) instead of creating a duplicate
- **85–95% match** — Close but newer. The old item gets superseded
- **Below 85%** — Different enough to be its own item

### People, projects, and things

Edda tracks **entities** — people, companies, projects, tools, concepts — and links them to related items. When you ask "what do I know about Sarah?", it assembles a profile on the fly from everything linked to that entity. No stale cache, always current.

## Architecture

```
edda/
  apps/server     — LangGraph agent backend (Node.js/TypeScript, port 8000)
  apps/web        — Next.js frontend (React 19, port 3000)
  packages/db     — Shared database client, queries, types, migrations
  packages/cli    — Interactive setup wizard
```

### What's under the hood

- **Agent framework**: [LangGraph](https://langchain-ai.github.io/langgraphjs/) + [LangChain](https://js.langchain.com/) for multi-provider LLM support
- **LLM providers**: Anthropic (default), OpenAI, Google, Groq, Ollama, Mistral, AWS Bedrock
- **Embeddings**: Voyage AI (default), OpenAI, Google
- **Database**: PostgreSQL + [pgvector](https://github.com/pgvector/pgvector) for semantic search
- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Scheduling**: node-cron with concurrency control

### Some design choices worth knowing about

**Configuration lives in the database, not env vars.** The `settings` table holds your LLM provider, model choice, and feature flags. You can swap models without redeploying.

**Tools are scoped by skill.** Each skill declares the tools it needs in its SKILL.md frontmatter. Agents only get access to tools from their assigned skills — there's no "god mode" by default.

**Migrations are append-only.** You never edit an existing migration file. New changes go in new files, always.

**The system prompt has three layers.** The agent's task description, its operating memory (AGENTS.md), and a deterministic system context (item types, active lists, rules). Each layer has different ownership and update frequency, which keeps things clean.

## Prerequisites

- **Node.js 20+**
- **pnpm**
- **PostgreSQL 14+** with [pgvector](https://github.com/pgvector/pgvector)
- An API key for at least one LLM provider (Anthropic recommended)
- An API key for an embedding provider (Voyage AI recommended)

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/your-org/edda.git
cd edda
pnpm install
```

### 2. Start Postgres

```bash
docker compose -f docker-compose.dev.yml up -d
```

This gives you PostgreSQL 16 with pgvector on `localhost:5432` (user: `edda`, password: `edda`, db: `edda`).

### 3. Set up your environment

The easiest way:
```bash
pnpm init
```

This wizard walks you through everything — database connection, LLM provider, embeddings, optional features — and writes your `.env` file.

Or do it manually:
```bash
cp .env.example .env
# Fill in DATABASE_URL and your API keys
```

### 4. Run migrations

```bash
pnpm migrate          # Create all the tables
pnpm db:seed-settings # Set defaults
```

### 5. Start it up

```bash
pnpm dev
```

Server runs on port 8000, web UI on port 3000. Open [http://localhost:3000](http://localhost:3000) and start talking to it.

## Configuration

### The essentials

| Variable | What it is |
|----------|-----------|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `LLM_PROVIDER` | `anthropic`, `openai`, `google`, `groq`, `ollama`, `mistral`, or `bedrock` |
| `LLM_MODEL` | The model to use (e.g., `claude-sonnet-4-20250514`) |
| Provider API key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. |
| `EMBEDDING_PROVIDER` | `voyage`, `openai`, or `google` |
| Embedding API key | `VOYAGEAI_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` |

### Optional stuff

| Variable | What it enables |
|----------|----------------|
| `EDDA_PASSWORD` | Password-protects the web UI. Leave empty for local dev |
| `SEARCH_PROVIDER` | Web search — `tavily`, `brave`, `serper`, or `serpapi` (needs its own API key) |
| `WOLFRAM_APP_ID` | WolframAlpha tool |
| `TELEGRAM_BOT_TOKEN` | Telegram integration (see setup below) |
| `INTERNAL_API_SECRET` | Backend auth. Required if you're using Telegram |
| `LANGSMITH_API_KEY` | LangSmith tracing |
| `CRON_RUNNER` | `local` (default) or `langgraph` |
| `CHECKPOINTER_BACKEND` | `postgres` (default), `sqlite`, or `memory` |
| `ALLOW_FILESYSTEM_ACCESS` | Set `true` + `FILESYSTEM_ROOT` for agent file access |
| `CORS_ORIGIN` | Backend CORS (default: `http://localhost:3000`) |

### Setting up Telegram

Telegram gives you two-way messaging with Edda from your phone — send it messages, get proactive updates from scheduled runs, link different group topics to different agents.

**1. Create a bot with BotFather**

Open [@BotFather](https://t.me/BotFather) in Telegram and run `/newbot`. Follow the prompts to pick a name. You'll get a bot token that looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`.

If you want the bot to read regular messages in group topics (not just `/commands`), go to @BotFather → `/mybots` → your bot → **Bot Settings** → **Group Privacy** → **Turn off**.

**2. Set three environment variables**

```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
INTERNAL_API_SECRET=<generate with: openssl rand -hex 32>
TELEGRAM_WEBHOOK_URL=https://your-server-domain.railway.app/api/telegram/webhook
```

`INTERNAL_API_SECRET` is required when Telegram is enabled — it authenticates both internal API calls and the Telegram webhook. If you're running locally, you can skip `TELEGRAM_WEBHOOK_URL` and it'll default to `http://localhost:8000/api/telegram/webhook` (you'll need something like ngrok for Telegram to reach it).

**3. Approve users**

When someone messages your bot for the first time, they get a "waiting for approval" message and a pairing request appears in the Edda web UI. Approve it there, and they're in. Rejected users are silently ignored.

**4. Bot commands**

Once approved, users can:
- `/link <agent_name>` — Link a forum topic to a specific agent (DMs automatically route to the default agent)
- `/unlink` — Remove the link
- `/status` — See which agent is connected and recent activity

You can have different forum topics linked to different agents — one for daily digests, another for a research agent, etc. Announcements from scheduled runs get pushed to any channel with announcements enabled.

### MCP connections

Edda can connect to remote [MCP](https://modelcontextprotocol.io/) servers for extra tools. API keys are stored as env var *references* in the database — just the variable name, not the actual secret. All MCP auth env vars must start with `MCP_AUTH_` (e.g., `MCP_AUTH_MYSERVICE_TOKEN`) to prevent accidental exfiltration of unrelated secrets.

## Deploying to Railway

[Railway](https://railway.com) is the simplest way to deploy Edda. The repo includes per-service `railway.toml` files that Railway picks up automatically.

### 1. Set up the project

Create a new Railway project and add a **PostgreSQL** add-on (it includes pgvector).

### 2. Add your environment variables

```
DATABASE_URL          → (Railway fills this in from the Postgres add-on)
LLM_PROVIDER          → anthropic
LLM_MODEL             → claude-sonnet-4-20250514
ANTHROPIC_API_KEY     → sk-ant-...
EMBEDDING_PROVIDER    → voyage
VOYAGEAI_API_KEY      → ...
CRON_RUNNER           → local
CHECKPOINTER_BACKEND  → postgres
NODE_ENV              → production
EDDA_PASSWORD         → (pick something — this protects your web UI)
INTERNAL_API_SECRET   → (generate a random string)
CORS_ORIGIN           → https://your-web-domain.railway.app
```

### 3. Connect your repo

Point Railway at your GitHub repo. It'll detect the monorepo structure from `pnpm-workspace.yaml` and create two services:

**Server** (`apps/server/railway.toml`):
- Builds the DB package and server
- Runs migrations and seeds settings on every deploy
- Health check at `/health`, auto-restarts on failure

**Web** (`apps/web/railway.toml`):
- Builds the DB package and Next.js app
- Runs the production server, auto-restarts on failure

### 4. Wire up networking

Railway gives each service its own URL. Set `CORS_ORIGIN` on the server to match whatever URL Railway assigned to your web service. That's it — migrations happen automatically on every deploy.

## Scheduling details

The cron runner reads from the `agent_schedules` table and fires agent runs using [node-cron](https://github.com/node-cron/node-cron). Each run gets a `task_run` record so you can see what happened, how long it took, and how many tokens it used.

Concurrency is capped at 3 parallel agent runs by default (configurable via `task_max_concurrency` in settings). Schedules sync every 5 minutes, so you can add or change them without restarting anything.

## Development

```bash
pnpm dev              # Everything in watch mode
pnpm build            # Build all packages
pnpm test             # Run tests (Vitest)
pnpm type-check       # TypeScript checks
pnpm lint             # Lint everything
pnpm format           # Prettier
pnpm eval             # Eval suite (server only)
```

### Project layout

```
apps/
  server/
    src/
      agent/           # Agent factory, tool definitions, skill loading
      channels/        # Platform adapters (Telegram)
      server/          # HTTP server, API routes
      utils/           # Notifications, reminders, concurrency
    skills/            # SKILL.md files
    evals/             # Eval suite
  web/
    src/
      app/             # Next.js pages and API routes
      components/      # UI components
      providers/       # React context providers

packages/
  db/
    src/               # Queries, types, connection pool
    migrations/        # SQL files (append-only)
  cli/
    src/               # Setup wizard
```

### Adding a tool

1. Create a file in `apps/server/src/agent/tools/` — it needs to export a Zod schema
2. Use query functions from `@edda/db` (no raw SQL in tool files)
3. Add the tool name to the relevant skill's `allowed-tools` in its SKILL.md
4. Export it from `apps/server/src/agent/tools/index.ts`

### Adding a skill

1. Make a new directory under `apps/server/skills/` with a `SKILL.md`
2. Include YAML frontmatter: `name`, `description`, `allowed-tools`
3. It gets picked up automatically on startup

### Database migrations

Always append-only:

```bash
touch packages/db/migrations/025_my_change.sql
pnpm migrate
```

Never edit an existing migration. If you need to change something, create a new file with the next number.

## Contributing

Contributions welcome. Open an issue first so we can talk about what you're thinking.

## License

MIT
