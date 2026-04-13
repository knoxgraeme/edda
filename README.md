<p align="center">
  <img src=".github/banner.png" alt="Edda" width="100%" />
</p>

> [!WARNING]
> **WIP — Untested in production, use with caution.**

**A self-hosted AI assistant that remembers you.**

Edda is an open-source personal assistant powered by LLMs. It extracts knowledge from your conversations, learns your preferences, remembers corrections, and runs scheduled tasks automatically. It gets better at helping you over time.

Built on [deepagents](https://www.npmjs.com/package/deepagents) (LangGraph + LangChain), PostgreSQL + pgvector, and Next.js.

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

| Agent | Skills | Thread | Schedules | Purpose |
|-------|--------|--------|-----------|---------|
| **edda** (default) | capture, recall, manage, admin, self-improvement, self-reflect, reminders | persistent | self-reflect (Sun 3am) | Conversational interface with inline memory capture |
| **digest** | daily-digest, weekly-report | daily | daily-digest (7am), weekly-report (Sun 6pm) | Summaries and weekly reflections |
| **maintenance** | type-evolution, memory-maintenance | ephemeral | type-evolution (monthly), memory-maintenance (Sun 4am) | Schema evolution, knowledge cleanup |

All agents are configurable — change skills, schedules, models, or disable them. Any agent can be the default.

### Custom agents

Create agents through the chat interface or API:

> "Create an agent called researcher with the recall and capture skills, triggered on demand, with an ephemeral thread lifetime"

Each agent gets scoped tools (based on assigned skills), a configurable thread lifetime (`ephemeral`, `daily`, or `persistent`), and its own AGENTS.md operating memory with self-improvement built in.

## Notifications & Channels

### Delivery targets

- **Inbox** — Web UI notifications with unread/read/dismissed lifecycle
- **Channels** — Two-way messaging via Telegram, Discord, and Slack
- **Announcements** — Scheduled run outputs pushed to agent's linked channels (zero LLM cost)
- **Agent triggers** — `agent:<name>` (passive, read on next run) or `agent:<name>:active` (triggers immediate run)

### Reminders

Time-based notifications that fire without invoking an LLM. Created via `create_reminder` tool. Supports cron expressions (`0 9 * * 4`) and PostgreSQL intervals (`1 day`, `2 hours`). The cron runner polls every 60 seconds with atomic claims and crash recovery.

### Channel adapters

| Platform | Transport | Features |
|----------|-----------|----------|
| **Telegram** | grammY, webhook | Forum topic routing, inline approval buttons, voice memos |
| **Discord** | discord.js, Gateway WebSocket | Slash commands (`/edda link\|unlink\|status`), streaming edits |
| **Slack** | @slack/bolt, Socket Mode | Slash command (`/edda`), ephemeral responses |

All adapters share: platform-agnostic inbound routing (`handle-message.ts`), access control via `paired_users`, and debounced progressive streaming (`stream-to-adapter.ts`).

## Memory system

### Storage

Every item gets a vector embedding. Items are typed (note, task, preference, learned_fact, pattern, etc.) with optional metadata. Search is semantic — matches on meaning, not keywords.

### Self-improvement loop

1. **During conversation** — `self-improvement` skill updates AGENTS.md immediately when user corrects the agent or expresses preferences. Also creates `session_note` items recording observations.
2. **Weekly reflection** — `self-reflect` skill (Sunday 3am) searches session notes since last run, identifies recurring patterns, surgically updates AGENTS.md. Optionally updates agent prompt if 3+ notes support a task-level change. Skipped (zero LLM cost) when no new session notes exist.
3. **Weekly maintenance** — `memory-maintenance` skill (Sunday 4am) merges near-duplicate items (>0.8 similarity), archives stale items (>90 days unreinforced), resolves contradictions.

### Implicit capture

When `memory_capture` is enabled on an agent, the `capture` skill extracts implicit knowledge (preferences, facts, patterns) inline during natural conversation. Lightweight: 1-2 tool calls per turn.

### Deduplication

Automatic for knowledge types (`preference`, `learned_fact`, `pattern`) in `create_item`:
- **95%+ similarity** — Existing item reinforced (`last_reinforced_at` updated, decay timer reset)
- **Below 95%** — New item created

The `capture` skill also instructs the agent to search at 0.85 before creating. `batch_create_items` bypasses dedup for performance.

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

- **Agent runtime**: [deepagents](https://www.npmjs.com/package/deepagents) (wraps [LangGraph](https://langchain-ai.github.io/langgraphjs/) + [LangChain](https://js.langchain.com/))
- **LLM providers**: 17+ — Anthropic, OpenAI, Google, Groq, Ollama, Mistral, Bedrock, xAI, DeepSeek, Cerebras, Fireworks, Together, Azure, OpenRouter, Minimax, Moonshot, ZhipuAI
- **Embeddings**: Voyage AI (default), OpenAI, Google
- **Database**: PostgreSQL + [pgvector](https://github.com/pgvector/pgvector)
- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Channels**: Telegram (grammY), Discord (discord.js), Slack (@slack/bolt)
- **Scheduling**: node-cron with concurrency control
- **MCP**: Multi-server client with stdio/SSE/streamable-http transports, OAuth PKCE

### Design decisions

- **Database-driven configuration** — LLM provider, model, and feature flags live in a `settings` table. Change models without redeploying.
- **Skill-based tool scoping** — Each skill declares required tools in SKILL.md frontmatter. Agents only access tools from their assigned skills. 14 built-in skills.
- **Append-only migrations** — Schema changes are always new files, never edits to existing ones.
- **Three-layer system prompt** — Agent task description (agent-editable) + operating memory/AGENTS.md (agent-editable) + deterministic system context (protected). Each layer has distinct ownership and update cadence.
- **Tool-level approvals** — Destructive tools (delete_item, delete_agent, etc.) are gated with configurable interrupt levels (`always`/`suggest`/`never`). Per-agent overrides via `metadata.interrupt_overrides`.
- **Cross-agent collaboration** — Sync delegation (`task` tool, deepagents native), async delegation (`run_agent`, fire-and-forget), cross-agent store access (`metadata.stores`), and cross-agent notifications.

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
| Provider API key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc. |

LLM provider, model, embedding provider/model, and feature flags are stored in the **`settings` database table** (not env vars). Configure via the web UI settings page, `pnpm db:seed-settings`, or the `update_settings` agent tool.

### Optional

| Variable | Description |
|----------|------------|
| `EDDA_PASSWORD` | Password-protect the web UI |
| `EDDA_ENCRYPTION_KEY` | Required for MCP OAuth token encryption (`openssl rand -base64 32`) |
| `TELEGRAM_BOT_TOKEN` | Telegram integration (see below) |
| `TELEGRAM_WEBHOOK_SECRET` | Required when `TELEGRAM_BOT_TOKEN` is set |
| `DISCORD_BOT_TOKEN` | Discord integration (Gateway WebSocket) |
| `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | Slack integration (Socket Mode) |
| `INTERNAL_API_SECRET` | Backend auth for server API |
| `LANGSMITH_API_KEY` | LangSmith tracing |
| `CORS_ORIGIN` | Backend CORS origin (default: `http://localhost:3000`) |

### Channel setup

#### Telegram

**1. Create a bot** — [@BotFather](https://t.me/BotFather) → `/newbot`. Disable Group Privacy for topic-based routing.

**2. Set environment variables** — `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.

**3. Approve users** — First-time users get a pairing request in the web UI inbox. Approve to grant access.

**4. Bot commands** — `/link <agent_name>`, `/unlink`, `/status`. DMs route to the default agent.

#### Discord

Set `DISCORD_BOT_TOKEN`. The bot connects via Gateway WebSocket. Slash commands: `/edda link|unlink|status`.

#### Slack

Set `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` (both required). Uses Socket Mode (no public URL needed). Slash command: `/edda link|unlink|status`.

### MCP connections

Edda supports [MCP](https://modelcontextprotocol.io/) servers for additional tools via stdio, SSE, or streamable-http transports. Includes SSRF prevention (blocks private/encoded IPs), environment sanitization, and OAuth PKCE for remote servers. Tokens encrypted at rest with AES-256-GCM (requires `EDDA_ENCRYPTION_KEY`).

## Deploying to Railway

[Railway](https://railway.com) is the recommended deployment platform. Per-service `railway.toml` files are included.

### 1. Create project

New Railway project + **PostgreSQL** add-on (includes pgvector).

### 2. Set environment variables

```
DATABASE_URL          → (auto-populated by PostgreSQL add-on)
ANTHROPIC_API_KEY     → sk-ant-...
VOYAGEAI_API_KEY      → ...
NODE_ENV              → production
EDDA_PASSWORD         → (set for public deployments)
EDDA_ENCRYPTION_KEY   → (openssl rand -base64 32)
INTERNAL_API_SECRET   → (openssl rand -hex 32)
CORS_ORIGIN           → https://your-web-domain.railway.app
```

LLM provider/model and embedding provider/model are configured in the DB `settings` table after first deploy (via `pnpm db:seed-settings` or the web UI settings page).

### 3. Connect repo

Link your GitHub repo. Railway detects the monorepo and creates two services:

- **Server** (`apps/server/railway.toml`) — Builds DB + server, runs migrations on deploy, health check at `/health`
- **Web** (`apps/web/railway.toml`) — Builds DB + Next.js app, runs production server

Set `CORS_ORIGIN` to your web service URL. Migrations run automatically on every deploy.

### 4. (Optional) Scale-to-zero via Railway Cron Jobs

For scale-to-zero pricing on the server, add a third Railway service using `apps/server/railway-cron.toml` as its config-as-code path. That service uses the same Dockerfile but starts `node apps/server/dist/cron-client.js` on a `* * * * *` [Railway Cron Job](https://docs.railway.com/cron-jobs) schedule — it posts to the main server's `/api/cron/tick` and exits.

Then flip the main server to http_trigger mode (web UI Settings page, or `UPDATE settings SET cron_runner = 'http_trigger'`) so it stops running its own timer. On the cron service, set:

```
SERVER_URL           → https://<your-server-service>.up.railway.app
INTERNAL_API_SECRET  → (same value as the main server)
```

Now the main server only runs when there's a chat request, a channel event, or a cron tick — and suspends in between. See [Scheduling architecture](#scheduling-architecture) for the full story.

## Scheduling

The cron runner reads `agent_schedules` and triggers agent runs via [node-cron](https://github.com/node-cron/node-cron). Each run creates a `task_run` record tracking duration, token usage, and output.

Concurrency capped at 3 parallel runs by default (`task_max_concurrency` setting). Schedules sync every 5 minutes — no restart needed for changes.

### Scheduling architecture

Edda supports two cron runner modes, controlled by `settings.cron_runner`:

| Mode | Who holds the timer | Best for |
|------|---------------------|----------|
| `in_process` (default) | Server process itself (node-cron + 60s reminder poll) | Local dev, VPS, home server, single-instance Fly/Railway |
| `http_trigger` | External scheduler posts to `/api/cron/tick` | Scale-to-zero hosts (Railway Cron Jobs, pg_cron, Cloud Run, Azure Container Apps) |

Both modes share the same inner code (`drainReminders`, `fireDueSchedules`, `runScheduleOnce`). Schedule fires are CAS-guarded via `agent_schedules.last_fired_at`, and reminders use `FOR UPDATE SKIP LOCKED` — so it's always safe to call `/api/cron/tick` even when the in-process runner is also active.

Switch modes via the web UI Settings page or:

```sql
UPDATE settings SET cron_runner = 'http_trigger';
```

#### External scheduler options

**Railway Cron Jobs** — see `apps/server/railway-cron.toml`. Deploy a second Railway service pointing at that config; it runs `node apps/server/dist/cron-client.js` on a `* * * * *` schedule, which posts to `/api/cron/tick`. Flip `cron_runner` to `http_trigger` on the main server so it stops running its own timer.

**pg_cron** — migration `014_pg_cron_setup.sql` sets up a DB-native cron on Postgres installs that support `pg_cron` + `pg_net` (Supabase, Neon, RDS, Azure Flexible Server, Cloud SQL, self-hosted). The migration is a graceful no-op on hosts without pg_cron. After the migration runs, set the two config values once:

```sql
ALTER DATABASE edda SET edda.cron_endpoint   = 'https://your-server/api/cron/tick';
ALTER DATABASE edda SET edda.internal_secret = '<your INTERNAL_API_SECRET>';
```

**Anything else that can make an authenticated HTTP POST every minute** — GitHub Actions cron, Fly machine cron, Cloud Scheduler, Azure Logic Apps, a cron entry on any box you own. The endpoint accepts an empty JSON body and returns `{ remindersFired, schedulesFired, durationMs }`. Auth with `Authorization: Bearer $INTERNAL_API_SECRET`.

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
      agent/           # Agent factory, tools, middleware, sandbox, backends
      channels/        # Platform adapters (Telegram, Discord, Slack)
      mcp/             # MCP client, OAuth, SSRF protection
      server/          # HTTP server, SSE streaming, API routes
      utils/           # Notifications, reminders, concurrency
    skills/            # 14 SKILL.md definitions with YAML frontmatter
    evals/             # Eval suite
  web/
    src/app/           # Next.js pages (chat, agents, inbox, settings, etc.)
    src/app/api/v1/    # REST API routes
    src/components/    # UI components

packages/
  db/
    src/               # Queries, types, connection pool
    migrations/        # 14 SQL files (append-only)
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
