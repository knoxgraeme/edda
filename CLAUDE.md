# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Edda is a full-stack AI personal assistant ("second brain") built as a pnpm monorepo with Turbo. It has a LangGraph-based agent backend, a Next.js frontend, a shared PostgreSQL database package, and a CLI setup wizard.

## Monorepo Structure

```
apps/server    — LangGraph agent backend (Node.js/TypeScript, port 8000)
apps/web       — Next.js 16 frontend (React 19, port 3000)
packages/db    — Shared database client, queries, types, and migrations
packages/cli   — Interactive setup wizard and deployment helpers
```

## Commands

All commands run from the repo root unless otherwise noted.

### Development
```bash
pnpm dev                          # Start all apps in dev mode (via Turbo)
pnpm build                        # Build all packages
pnpm lint                         # Lint all packages
pnpm format                       # Format with Prettier
pnpm format:check                 # Check formatting without writing

# Local Postgres + pgvector
docker compose -f docker-compose.dev.yml up
```

### Database
```bash
pnpm migrate                      # Run SQL migrations
pnpm db:seed-settings             # Seed default settings
```

### Evals (server only)
```bash
pnpm eval                         # Run eval suite (Vitest)
pnpm eval:ci                      # CI mode
cd apps/server && pnpm eval:watch # Watch mode for a single eval
cd apps/server && pnpm eval:capture  # Capture new eval baselines
```

### CLI / Setup
```bash
pnpm init                         # Run interactive setup wizard
```

## Architecture

### Backend (`apps/server`)

The server is built around **LangGraph** for agentic orchestration and **LangChain** for multi-provider LLM abstraction.

- **`src/index.ts`** — Entry point; orchestrates startup
- **`src/agent/build-agent.ts`** — Unified agent factory: `buildAgent(agent)` builds any agent from an `Agent` DB row with skill-based tool scoping, prompt building, and backend assembly
- **`src/agent/middleware.ts`** — Middleware builder: `buildMiddleware(agent)` assembles per-agent middleware (tool call limits, model call limits, context editing, model retry). Defaults overridable via `agent.metadata.middleware`.
- **`src/agent/backends.ts`** — CompositeBackend factory: `/skills/` (progressive disclosure), `/store/` (own namespace), cross-agent store mounts (`metadata.stores`)
- **`src/agent/tools/`** — Tool definitions (each exports a Zod schema)
- **`src/agent/tools/get-agents-md.ts`** — Returns current AGENTS.md content and token budget for the calling agent.
- **`src/mcp/client.ts`** — MCP client manager (multi-server, SSRF-safe fetch, OAuth support)
- **`src/mcp/oauth-provider.ts`** — MCP OAuth provider (PKCE, token storage)
- **`src/logger.ts`** — Structured logging via Pino with AsyncLocalStorage trace context. `getLogger()` returns the contextual logger; `withTraceId(bindings, fn)` scopes a traceId to an async call tree. Uses `pino-pretty` in development. Sensitive data (DB URLs, API keys) is auto-redacted in error serializers.
- **`src/llm.ts`** — LLM model-string resolver: `getModelString(agentProvider?, agentModel?)` returns `provider:model` strings for deepagents/LangChain's `initChatModel`. Maps Edda DB provider names to LangChain keys via `PROVIDER_MAP`. Per-agent overrides are nullable (NULL = inherit from `settings` table).
- **`src/embed.ts`** — Embedding provider factory (Voyage, OpenAI, Google)
- **`src/search.ts`** — Search tool factory
- **`src/store.ts`** — LangGraph store backend factory
- **`src/checkpointer.ts`** — State checkpointing backend (postgres, sqlite, or memory)
- **`src/skills/`** — Modular agent capabilities: `admin`, `capture`, `daily_digest`, `manage`, `memory_maintenance`, `recall`, `reminders`, `self_improvement`, `self_reflect`, `type_evolution`, `weekly_report`
- **`src/cron.ts`** — Local cron runner using node-cron; reads `agent_schedules` table, creates `task_run` records, syncs dynamically, polls for due reminders every 60s
- **`src/channels/`** — External channel adapters for delivering agent output. `telegram.ts` (webhook-based Telegram bot), `discord.ts` (Gateway WebSocket via discord.js), `slack.ts` (Socket Mode via @slack/bolt), `deliver.ts` (routes messages to platform adapters), `handle-message.ts` (platform-agnostic inbound handler), `adapter.ts` (ChannelAdapter interface), `utils.ts` (shared helpers like `splitMessage`)
- **`src/agent/stream-to-adapter.ts`** — Streaming delivery with debounced edits and adapter fallback behavior
- **`src/utils/notify.ts`** — Multi-target notification delivery; routes to inbox (DB row), announce (channel delivery via `deliverToChannel`), or agent (triggers agent run)
- **`src/utils/reminder-recurrence.ts`** — Cron expression and interval string parsing, validation, and next-date computation (uses `cron-parser`)
- **`src/utils/semaphore.ts`** — Concurrency limiter (async-mutex) for parallel agent execution
- **`src/utils/with-timeout.ts`** — Promise timeout wrapper for agent executions
- **`src/utils/sanitize-error.ts`** — Strips internal details from errors before returning to agents
- **`src/evals/`** — Vitest-based evaluation suite

### Frontend (`apps/web`)

Next.js App Router with React 19.

- **`src/app/`** — Route pages: `/` (chat), `/agents`, `/dashboard`, `/entities`, `/inbox`, `/settings`, `/skills`, `/login`
- **`src/app/api/v1/`** — REST API routes (agents, channels, confirmations, dashboard, entities, item-types, items, mcp-connections, mcp-oauth, notifications, reminders, schedules, settings, skills, task-runs, threads, timeline)
- **`src/middleware.ts`** — Next.js middleware; enforces optional password auth via `EDDA_PASSWORD`
- **`src/lib/auth.ts`** — Session token helpers (HMAC-based cookie auth)
- **`src/providers/`** — `ChatProvider` and `ClientProvider` context providers
- **`src/app/hooks/`** — Custom React hooks
- **`src/components/ui/`** — Shared UI primitives

### Database Package (`packages/db`)

Single source of truth for data model and queries.

- **`src/types.ts`** — Core types: `Settings`, `Item`, `Entity`, `ItemType`, `McpConnection`, `AgentsMdVersion`, `Agent`, `AgentSchedule`, `TaskRun`, `Notification`, `Channel`, `TelegramUser`, `PairedUser`, `List`, `Thread`, `PendingItem`
- **`src/index.ts`** — PostgreSQL connection pool and re-exports
- **`src/agents.ts`** — CRUD for agents (create, update, delete, list, getByName)
- **`src/agent-schedules.ts`** — Per-agent cron schedule CRUD
- **`src/task-runs.ts`** — Task run lifecycle (create, start, complete, fail, getRecent)
- **`src/notifications.ts`** — Notification lifecycle: create, dismiss, claim due reminders, advance/complete recurring reminders, cleanup expired
- **`src/channels.ts`** — Agent-channel link CRUD (agent_channels table)
- **`src/telegram-users.ts`** — Telegram user pairing and lookup (legacy; see `paired-users.ts`)
- **`src/paired-users.ts`** — Platform-agnostic user pairing: `checkPlatformUser`, `requestPlatformPairing`, approve/reject, pending list
- **`src/threads.ts`** — Thread management with agent scoping and processing watermarks
- **`src/lists.ts`** — First-class lists with pgvector embeddings
- **`src/mcp-oauth.ts`** — OAuth state and token management for MCP connections
- **`src/crypto.ts`** — AES-256-GCM encryption/decryption for sensitive credentials
- **`src/confirmations.ts`** — Pending confirmation queries (item_types, entities)
- **`src/dashboard.ts`** — Dashboard aggregation queries
- **`src/skills.ts`** — Skill metadata storage and retrieval
- **`migrations/`** — Ordered SQL migration files; applied via `pnpm migrate`
- Key tables: `settings`, `item_types`, `items` (with pgvector embeddings), `entities`, `lists`, `mcp_connections`, `mcp_oauth_states`, `agents_md_versions`, `agents`, `agent_schedules`, `agent_channels`, `task_runs`, `notifications`, `threads`, `telegram_paired_users`, `paired_users`, `skills`

### Configuration Strategy

LLM provider, model, embedding provider, and feature flags are stored in the **`settings` database table** (not hardcoded). The factory functions in `src/llm.ts` and `src/embed.ts` read from this table at runtime. Use `pnpm db:seed-settings` to populate defaults.

Critical env vars (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` — API keys for whichever LLM/embedding provider is selected in DB settings
- `EDDA_PASSWORD` — optional; set to enable password-gated web UI (leave empty for local dev)
- `TELEGRAM_BOT_TOKEN` — optional; enables Telegram channel integration for agent message delivery
- `TELEGRAM_WEBHOOK_SECRET` — required when `TELEGRAM_BOT_TOKEN` is set; dedicated secret for Telegram webhook verification
- `DISCORD_BOT_TOKEN` — optional; enables Discord channel integration (Gateway WebSocket)
- `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` — optional; both required to enable Slack channel integration (Socket Mode)
- `EDDA_ENCRYPTION_KEY` — required for MCP OAuth token encryption (generate with `openssl rand -base64 32`)

Notable DB settings (in `settings` table):
- `default_agent` — Name of the agent to use as the default conversational agent (default: `edda`)
- `task_max_concurrency` — Max parallel agent executions (default: 3)
- `checkpointer_backend` — `postgres`, `sqlite`, or `memory` (server uses this directly)
- `cron_runner` — `local` or `langgraph` (server currently runs local; logs fallback when set to `langgraph`)

### Agents (Multi-Agent System)

Edda uses a unified multi-agent architecture. All agents are built by `buildAgent(agent)` — there is no separate orchestrator factory. A `default_agent` setting (default: `edda`) determines which agent serves as the conversational interface. Any agent can be the default.

- **`agents`** table — Single source of truth for all agents (system + user-created). Each row defines: name, description, system_prompt, skills[], tools[], subagents[], thread_lifetime, trigger, model_settings_key, enabled flag, metadata.
- **`agent_schedules`** table — Per-agent cron triggers. Each row defines: agent_id, name, cron expression, prompt (user message), optional thread_lifetime override, enabled flag, `notify` (target array for delivery on completion/failure), `notify_expires_after` (interval for notification expiry), `skip_when_empty_type` (skip run if no new items of this type since last completion). One agent can have multiple schedules.
- **`task_runs`** table — Tracks every agent execution with full lifecycle: pending → running → completed/failed. Records trigger source, duration, token usage, output summary, and errors
- **Thread lifetimes**: `ephemeral` (new thread every run), `daily` (shared thread per day), `persistent` (single shared thread)
- **Tool scoping**: Each agent's tools are resolved additively — union of `allowed-tools` from SKILL.md frontmatter across all skills, plus any individual tools in `agent.tools[]`. Empty = all tools (backward compatible). Each SKILL.md declares its required tools via `allowed-tools` YAML frontmatter.
- **`metadata.stores`** — Cross-agent store access. Keys are agent names (or `"*"` for wildcard), values are `"read"` or `"readwrite"`. Example: `{ "daily_digest": "read", "*": "read" }`.
- **`metadata.middleware`** — Per-agent middleware overrides. Keys: `toolCallRunLimit` (default 30), `modelCallRunLimit` (default 15), `toolLimits` (per-tool limits, e.g. `{ "web_search": 5 }`), `contextEditingTriggerTokens` (default 80000), `contextEditingKeepMessages` (default 5), `contextEditingExcludeTools` (tool names to skip clearing). All limits are per-run (reset each invocation).

**Built-in system agents**:
| Agent | Skills | Thread Lifetime | Schedules |
|---|---|---|---|
| edda | capture, recall, manage, admin, self_improvement, self_reflect, reminders | persistent | self_reflect (Sun 3am, ephemeral) |
| digest | daily_digest, weekly_report | daily | daily_digest (7am), weekly_report (Sun 6pm) |
| maintenance | type_evolution, memory_maintenance | ephemeral | type_evolution (6am), memory_maintenance (Sun 4am) |

Per-agent memory config: `memory_capture` (inline extraction during conversation) and `memory_self_reflect` (scheduled self-improvement). New user-created agents automatically get the `self_improvement` skill, a seeded AGENTS.md, and default `self_reflect` schedule.

### System Prompt Architecture (Three Layers)

The assembled system prompt has three layers with distinct ownership:

1. **Agent prompt** (Layer 1) — The agent's task description (`agent.system_prompt` DB field). Agent-editable via `update_agent` tool, guided by `self_improvement` skill. Structured as Task/Output/Boundaries.
2. **Memory** (Layer 2) — AGENTS.md procedural memory wrapped in `<agent_memory>` tags. Agent-editable via `save_agents_md` tool. Contains: Communication, Patterns, Standards, Corrections. Memory guidelines live in the `self_improvement` skill (not the system prompt).
3. **System context** (Layer 3) — Deterministic, slim sections: Capabilities, Rules (dedup + token budget), Context (date/tz/user/memory capture). Dynamic data (item types, lists, approval settings) is available via tools and skills, not baked into the prompt.

Built by `buildPrompt()` in `src/agent/build-agent.ts`.

### AGENTS.md (Procedural Memory)

AGENTS.md is the agent's operating notes about how to serve a specific user — communication preferences, behavioral patterns, quality standards, and corrections. Stored in `agents_md_versions` DB table (not on disk), scoped per agent.

- **`src/agent/tools/get-agents-md.ts`** — Returns current AGENTS.md content and token budget for the calling agent.
- **`src/agent/tools/save-agents-md.ts`** — Writes curated AGENTS.md content to DB. Used by `self_reflect` (scheduled) and `self_improvement` (real-time).
- **Seeding**: `create_agent` tool auto-seeds an empty AGENTS.md with section scaffolding (Communication, Patterns, Standards, Corrections)
- **Self-improvement loop**: Real-time corrections via `self_improvement` skill → scheduled cross-session analysis via `self_reflect` (reviews `session_note` items → updates AGENTS.md)

### Memory System

Memory uses three complementary mechanisms:

| Layer | What It Stores | Implementation |
|---|---|---|
| **Knowledge** | Facts about user/world | `items` table + pgvector search |
| **History** | Past conversations and runs | Checkpointer + `task_runs` |
| **Operating notes** | How the agent should behave | AGENTS.md + agent prompt |

- **`capture` skill (implicit capture)** — When `memory_capture = true`, the agent extracts implicit knowledge (preferences, facts, patterns) and entities inline during conversation. No separate extraction agent needed.
- **`session_note` item type** — Agent observations about conversations (corrections, quality signals, user feedback). Created during conversation, consumed by `self_reflect` for cross-session improvement.
- **`self_reflect` skill** — Scheduled per-agent self-improvement. Searches session notes since last run, identifies recurring patterns, updates AGENTS.md. Skipped (zero LLM cost) when no new session notes exist via `skip_when_empty_type` on the schedule.
- **`get_entity_profile` tool** — Dynamically assembles a complete entity profile from `entities` + linked `items`; always fresh, no cron needed
- **Dedup**: Semantic similarity thresholds — reinforce ≥0.95, supersede 0.85–0.95, create new otherwise

### Notification System

Edda has a multi-target notification system for delivering messages from agents, schedules, and reminders.

- **`notify()` utility** (`apps/server/src/utils/notify.ts`) — Central delivery function. Routes to targets based on prefix: `inbox` (creates DB notification row), `announce:<agent_name>` (delivers to agent's linked channels), `agent:<agent_name>:active` (triggers a live agent run).
- **`notifications` table** — Stores all notifications with status lifecycle. Statuses: `unread` → `read` → `dismissed` for standard notifications; `scheduled` → `sending` → `sent` for reminders. `dismissed` also used for cancellation.
- **Scheduled reminders** — Zero-LLM notifications that fire on time without an agent run. Created via `create_reminder` tool. The cron runner polls every 60 seconds, claims due rows atomically (`UPDATE ... SET status='sending' WHERE status='scheduled' AND scheduled_at <= now() ... FOR UPDATE SKIP LOCKED`), fires through `notify()`, then advances (recurring) or completes (one-shot).
- **Recurrence** — Supports cron expressions (5 fields, e.g. `0 9 * * 4`) computed via `cron-parser`, or PostgreSQL interval strings (e.g. `1 day`, `2 hours`) with a 5-minute minimum floor. Cron computes next date explicitly; intervals use `scheduled_at + interval` in SQL.
- **Crash recovery** — `resetStuckSendingReminders()` resets `sending` rows older than 5 minutes back to `scheduled` on startup and during periodic sync.
- **Per-schedule notifications** — Each `agent_schedule` has a `notify` array and optional `notify_expires_after`. On schedule completion/failure, results are delivered to the configured targets.

### Channels (External Delivery)

Agents can be linked to external messaging platforms for receiving messages and broadcasting output. All adapters implement the `ChannelAdapter` interface (`adapter.ts`) and share inbound routing (`handle-message.ts`) and streaming delivery (`stream-to-adapter.ts`).

- **`agent_channels` table** — Links agents to external platform channels. Each row defines: agent_id, platform (`telegram`, `discord`, `slack`), external_id (platform-specific chat ID), config, `enabled`, and `receive_announcements`.
- **`paired_users` table** — Platform-agnostic user pairing for access control. Maps `(platform, platform_user_id)` to approval status (`pending`, `approved`, `rejected`). All adapters check pairing before routing messages.
- **`telegram_paired_users` table** — Legacy Telegram-specific pairing (preserved; new pairing uses `paired_users`).
- **`apps/server/src/channels/telegram.ts`** — Telegram bot adapter (grammY, webhook-based) with `x-telegram-bot-api-secret-token` verification. Forum topic support via `message_thread_id`.
- **`apps/server/src/channels/discord.ts`** — Discord bot adapter (discord.js, Gateway WebSocket). Slash commands: `/edda link|unlink|status`. Uses channel cache and single REST call for streaming edits.
- **`apps/server/src/channels/slack.ts`** — Slack bot adapter (@slack/bolt, Socket Mode). Slash command: `/edda link|unlink|status`. Ephemeral responses for errors/status.
- **`apps/server/src/channels/deliver.ts`** — Platform-agnostic delivery router. `deliverToChannel(channel, message)` dispatches to the appropriate registered adapter.
- **`apps/server/src/channels/handle-message.ts`** — Shared inbound handler: resolves channel→agent, builds thread, streams response.
- **`apps/server/src/agent/stream-to-adapter.ts`** — Streaming delivery with debounced message edits and fallback to `send()`.
- **Announcement flow** — When a scheduled agent run completes, the cron runner queries `getChannelsByAgent(agentId, { receiveAnnouncements: true })` and delivers the last assistant message to each linked channel.

### MCP OAuth

Edda supports OAuth authentication for connecting to remote MCP servers.

- **`mcp_oauth_states` table** — Stores OAuth flow state (PKCE challenge, redirect URI) during the authorization dance.
- **`packages/db/src/crypto.ts`** — AES-256-GCM encryption for storing OAuth tokens at rest. Requires `EDDA_ENCRYPTION_KEY` env var.
- **`apps/web/src/app/api/v1/mcp-oauth/`** — OAuth callback handler that completes the authorization flow and stores encrypted tokens.

## Code Style

- TypeScript strict mode, ES2022, ESM modules throughout
- Prettier: 2-space indent, trailing commas, 100-char line width (see `.prettierrc`)
- Node version: 20 (see `.nvmrc`)

## Architecture Rules

These rules are enforced by the post-edit hook (`.claude/hooks/scripts/post-edit-checks.sh`):

1. **Server tools must use `@edda/db` query functions** — Files in `apps/server/src/agent/tools/` must import and use query functions from `@edda/db` (in `packages/db/src/queries/`). Never use raw SQL (`pool.query`, `client.query`) in tool files.

2. **Client components must not import server packages** — Files with `'use client'` must not import from `@edda/db` or `@edda/server`. Database access from client components must go through API routes or server components.

3. **Tool files must export a Zod schema** — Every tool file in `apps/server/src/agent/tools/` must export a Zod schema for input validation.

4. **Migrations are append-only** — Never modify an existing migration file in `packages/db/migrations/`. Always create a new migration with the next sequence number.

## Testing Conventions

```bash
pnpm test                         # Run all tests (via Turbo)
pnpm type-check                   # TypeScript type check across all packages
pnpm eval                         # Run eval suite (server only)
```

- Tests use Vitest
- Type checking runs `tsc --noEmit` in each package
- The Stop hook automatically runs type-check, lint, and test before session end
- CI runs: install -> type-check -> lint -> test -> build

## Error Handling Conventions

- Use `loadConfig()` from `apps/server/src/config.ts` for environment validation at startup — it uses Zod and throws descriptive errors for missing/invalid env vars
- Prefer early returns with descriptive error messages over nested try/catch
- Let LangGraph handle agent-level error recovery; tools should throw on failure rather than returning error strings
