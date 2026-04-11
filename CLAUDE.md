# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Edda is a full-stack AI personal assistant ("second brain") built as a pnpm monorepo with Turbo. It uses [deepagents](https://www.npmjs.com/package/deepagents) (built on LangGraph + LangChain) as its core agent runtime, a Next.js frontend, a shared PostgreSQL database package, and a CLI setup wizard.

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

The server is built on **[deepagents](https://www.npmjs.com/package/deepagents)** (`createDeepAgent()`) which wraps LangGraph and LangChain. Edda never uses LangGraph graph primitives (StateGraph, createReactAgent) directly — all agents are created via `createDeepAgent()`.

#### Agent Runtime
- **`src/agent/build-agent.ts`** — Unified agent factory: `buildAgent(agent)` builds any agent from an `Agent` DB row. Resolves model, gathers tools (built-in + MCP + community), scopes via skills, builds three-layer prompt, assembles CompositeBackend, resolves subagents, and calls `createDeepAgent()`. This is the single entry point — server startup, cron runner, and on-demand execution all use it.
- **`src/agent/middleware.ts`** — Middleware builder: `buildMiddleware(agent)` assembles per-agent middleware (tool call limits, model call limits, context editing, model retry). Defaults overridable via `agent.metadata.middleware`.
- **`src/agent/middleware/lazy-tools.ts`** — Progressive tool disclosure: hides skill-specific tools until the agent reads the corresponding SKILL.md. Tracks activated skills by intercepting `read_file` calls.
- **`src/agent/backends.ts`** — CompositeBackend factory: `/skills/` (progressive disclosure via deepagents StoreBackend), `/store/` (own namespace, persistent cross-thread), cross-agent store mounts via `metadata.stores`. Includes `ReadOnlyStoreBackend` for permission-enforced cross-agent reads and `SandboxCompositeBackend` for code execution.
- **`src/agent/interrupt-wrapper.ts`** — Tool-level approval system: wraps `"always"` interrupt tools with a gating function that creates `pending_actions` DB rows and returns a structured JSON response to the agent.
- **`src/agent/execute-approved-action.ts`** — After user approves a gated tool call, finds the original tool and executes it, optionally injecting the result back into the agent's thread.
- **`src/agent/resolve-action.ts`** — Orchestrates approval resolution: atomic DB update, channel surface cleanup (remove buttons), and tool execution.
- **`src/agent/sandbox.ts`** — `SecureSandbox` wrapping `@langchain/node-vfs` VfsSandbox with shell injection prevention, global command denylist, optional skill-level command allowlist, and env stripping. Guardrail only — not a security boundary (no process/filesystem isolation).
- **`src/agent/skill-utils.ts`** — Writes SKILL.md files to LangGraph BaseStore for deepagents progressive disclosure. Parses YAML frontmatter for `allowed-tools` and `allowed-commands`.
- **`src/agent/run-execution.ts`** — Shared agent invocation: `executeAgentRun()` called by cron and on-demand runs.

#### Tools & Skills
- **`src/agent/tools/`** — 46+ tool definitions (each exports a Zod schema). Categories: items (CRUD, search, batch), lists, entities (upsert, link, profile), types, threads, settings, MCP connections, confirmations, agents (create, run, update, delete), AGENTS.md (get/save), notifications, channels, reminders, schedules, skills.
- **`skills/`** — 14 SKILL.md files with YAML frontmatter: `admin`, `agent-creation`, `capture`, `coding`, `daily-digest`, `manage`, `memory-maintenance`, `recall`, `reminders`, `self-improvement`, `self-reflect`, `skill-management`, `type-evolution`, `weekly-report`. Skills declare `allowed-tools` and optionally `allowed-commands` in frontmatter.

#### Infrastructure
- **`src/index.ts`** — Entry point; orchestrates startup (migrations, agent build, cron, channels)
- **`src/server/index.ts`** — HTTP server with SSE streaming endpoint (`POST /api/stream`), thread management, agent run API, semantic search, pending action resolution, MCP OAuth callback, and channel webhooks.
- **`src/llm.ts`** — LLM model-string resolver: `getModelString()` returns `provider:model` strings for `initChatModel`. `resolveModel()` handles providers not in LangChain's registry (OpenRouter, Minimax, etc.) by direct class instantiation. 17+ providers: Anthropic, OpenAI, Google, Groq, Ollama, Mistral, Bedrock, xAI, DeepSeek, Cerebras, Fireworks, Together, Azure, OpenRouter, Minimax, Moonshot, ZhipuAI.
- **`src/embed.ts`** — Embedding provider factory (Voyage, OpenAI, Google). Formats text as `"${type}: ${content}${summary}"` for consistent vector space. Batch embedding with 96-item chunks.
- **`src/search.ts`** — Web search tool factory (Tavily, Brave, Serper, SerpAPI, DuckDuckGo)
- **`src/store.ts`** — LangGraph `PostgresStore` singleton for persistent cross-thread state
- **`src/checkpointer.ts`** — State checkpointing backend (postgres, sqlite, or memory)
- **`src/mcp/client.ts`** — MCP client manager: singleton `MultiServerMCPClient`, stdio/SSE/streamable-http transports, SSRF prevention (blocks private/encoded IPs), env sanitization, OAuth PKCE. Tools prefixed `mcp__${serverName}__${toolName}`.
- **`src/logger.ts`** — Structured logging via Pino with AsyncLocalStorage trace context. Auto-redacts sensitive data.
- **`src/cron.ts`** — Local cron runner (386 lines, node-cron); reads `agent_schedules` table, creates `task_run` records, syncs dynamically, polls for due reminders every 60s, handles `skip_when_empty_type` optimization, notification consumption/delivery, crash recovery.
- **`src/channels/`** — External channel adapters: `telegram.ts` (grammY, webhook), `discord.ts` (discord.js, Gateway WebSocket), `slack.ts` (@slack/bolt, Socket Mode). Shared: `adapter.ts` (ChannelAdapter interface), `handle-message.ts` (platform-agnostic inbound: access control → channel→agent resolution → thread resolution → streaming), `deliver.ts` (outbound routing), `stream-to-adapter.ts` (debounced progressive edits, 1/sec, 50 char min, with fallback).
- **`src/utils/notify.ts`** — Multi-target notification delivery. Targets: `inbox` (DB row), `announce:<agent_name>` (channel delivery), `agent:<agent_name>` (passive), `agent:<agent_name>:active` (triggers live run).
- **`src/utils/reminder-recurrence.ts`** — Cron expression and interval string parsing/validation (uses `cron-parser`)
- **`src/utils/semaphore.ts`** — Concurrency limiter (async-mutex) for parallel agent execution
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

- **`src/types.ts`** — Core types: `Settings`, `Item`, `Entity`, `ItemType`, `McpConnection`, `AgentsMdVersion`, `Agent`, `AgentSchedule`, `TaskRun`, `Notification`, `Channel`, `TelegramUser`, `PairedUser`, `List`, `Thread`, `PendingItem`, `PendingAction`
- **`src/index.ts`** — PostgreSQL connection pool and re-exports
- **`src/connection.ts`** — Pool singleton with `getPool()`
- **`src/agents.ts`** — CRUD for agents (create, update, delete, list, getByName, modifyAgentTools)
- **`src/agent-schedules.ts`** — Per-agent cron schedule CRUD
- **`src/agents-md.ts`** — Versioned AGENTS.md storage: `getAgentsMdContent`, `saveAgentsMdVersion`, `pruneAgentsMdVersions`
- **`src/items.ts`** — Item CRUD + semantic search: `createItem`, `updateItem`, `batchCreateItems`, `searchItems` (two-phase: cosine similarity → exponential time-decay re-ranking with 3x candidate over-fetch)
- **`src/entities.ts`** — Entity CRUD with embedding: `upsertEntity`, `listEntityItems`, `getEntityProfile`
- **`src/item-types.ts`** — Item type CRUD with per-type decay half-life
- **`src/lists.ts`** — First-class lists with pgvector embeddings
- **`src/task-runs.ts`** — Task run lifecycle (create, start, complete, fail, getRecent)
- **`src/notifications.ts`** — Notification lifecycle: create, dismiss, claim due reminders, advance/complete recurring reminders, cleanup expired, `resetStuckSendingReminders`
- **`src/pending-actions.ts`** — Tool-level interrupt approvals: `createPendingAction`, `resolvePendingAction` (atomic), `expirePendingActions`, `addChannelRef`
- **`src/channels.ts`** — Agent-channel link CRUD (agent_channels table)
- **`src/telegram-users.ts`** — Telegram user pairing and lookup (legacy; see `paired-users.ts`)
- **`src/paired-users.ts`** — Platform-agnostic user pairing: `checkPlatformUser`, `requestPlatformPairing`, approve/reject, pending list
- **`src/confirmations.ts`** — Pending confirmation queries across items, entities, item_types, and pairings (unified `getPendingItems`)
- **`src/threads.ts`** — Thread management with agent scoping and processing watermarks
- **`src/settings.ts`** — Settings CRUD (single-row config table)
- **`src/skills.ts`** — Skill metadata storage and retrieval (DB-backed, not disk)
- **`src/mcp-connections.ts`** — MCP connection CRUD
- **`src/mcp-oauth.ts`** — OAuth state and token management for MCP connections
- **`src/crypto.ts`** — AES-256-GCM encryption/decryption for sensitive credentials
- **`src/dashboard.ts`** — Dashboard aggregation queries
- **`src/seed-settings.ts`** — Default settings seeder
- **`src/migrate.ts`** — Migration runner
- **`migrations/`** — 14 ordered SQL migration files; applied via `pnpm migrate`
- Key tables: `settings`, `item_types`, `items` (with pgvector embeddings), `entities`, `item_entities`, `lists`, `mcp_connections`, `mcp_oauth_states`, `agents_md_versions`, `agents`, `agent_schedules`, `agent_channels`, `task_runs`, `notifications`, `threads`, `telegram_paired_users`, `paired_users`, `skills`, `pending_actions`

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
- `sandbox_provider` — `none`, `node-vfs`, `daytona`, or `deno` (only `node-vfs` implemented; default: `node-vfs`)
- `embedding_provider` / `embedding_model` / `embedding_dimensions` — configurable embedding backend
- `agents_md_token_budget` — max token budget for AGENTS.md content (default: 4000)
- `agents_md_max_versions` — versions to retain before pruning (default: 30)
- `approval_new_entity` — `auto` or `confirm` (default: auto)
- `approval_new_type` — `auto` or `confirm` (default: confirm)
- `user_timezone` — IANA timezone for date display and cron scheduling
- `user_display_name` — injected into system prompt context

### deepagents Integration

Edda uses `deepagents` (v1.7.0) as a thin orchestration layer. The `createDeepAgent()` call in `buildAgent()` receives: model, tools, systemPrompt, checkpointer, store, backend, subagents, skills, middleware. Everything else (scheduling, notifications, channels, approvals, memory management) is custom Edda code.

**What deepagents provides:**
- Agent runtime (replaces direct StateGraph/createReactAgent usage)
- `CompositeBackend` + `StoreBackend` for virtual filesystem mounts
- `SandboxBackendProtocol` for code execution
- Native `task` tool for synchronous subagent delegation (auto-injected when subagents present)
- Progressive skill disclosure via `/skills/` mount

**What Edda builds on top:**
- Scheduling (`cron.ts`) + reminder polling
- Notification system (`notify.ts`) + inbox
- Tool-level approvals (`interrupt-wrapper.ts` + `pending_actions` table)
- Channel adapters (Telegram, Discord, Slack)
- Streaming delivery (`stream-to-adapter.ts`)
- Memory system (items + pgvector + AGENTS.md)
- Lazy tools middleware (`middleware/lazy-tools.ts`)

### Tool Approval System

Two parallel approval systems exist:

1. **Entity/type/pairing confirmations** (`confirmations.ts`) — `confirmed` boolean on items, entities, item_types, and paired_users. Surfaced in inbox Confirmations tab. Controlled by `approval_new_entity` and `approval_new_type` settings.

2. **Tool-level interrupts** (`pending_actions` table) — for destructive tools (delete_item, delete_agent, etc.). Implemented via `interrupt-wrapper.ts` which wraps `"always"` tools with a gating function. Flow: agent calls gated tool → wrapper creates `pending_actions` row → returns JSON to agent → user approves via channel button or API → `resolve-action.ts` executes the original tool. Per-tool config in `toolInterruptDefaults` with per-agent overrides via `metadata.interrupt_overrides`.

### Agents (Multi-Agent System)

Edda uses a unified multi-agent architecture. All agents are built by `buildAgent(agent)` — there is no separate orchestrator factory. A `default_agent` setting (default: `edda`) determines which agent serves as the conversational interface. Any agent can be the default.

- **`agents`** table — Single source of truth for all agents (system + user-created). Each row defines: name, description, system_prompt, skills[], tools[], subagents[], thread_lifetime, thread_scope, trigger, model_provider, model, enabled flag, memory_capture, memory_self_reflect, metadata.
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

### Cross-Agent Collaboration

Three delegation mechanisms:

1. **Sync delegation** (`task` tool, deepagents native) — when an agent has `subagents[]`, deepagents injects a `task` tool. Blocks until subagent completes, returns result inline. Each subagent gets its own scoped tools, skills, model, and system prompt. Resolved at build time via `resolveSubagents()`. Max depth not enforced by Edda (deepagents default).

2. **Async delegation** (`run_agent` tool) — fire-and-forget. Creates `task_run` with `trigger: "agent"`, executes target in background with concurrency limiting (`task_max_concurrency`). Returns `task_run_id` immediately; caller polls via `get_task_run`.

3. **Cross-agent notifications** — `send_notification` with `target: "agent:<name>"` (passive, read on next run) or `target: "agent:<name>:active"` (triggers immediate run consuming the notification).

**Cross-agent store access** (`metadata.stores`): Each agent's `/store/` is namespaced by agent name. `metadata.stores` declaratively mounts other agents' stores: `{ "daily_digest": "read", "*": "read" }`. Mounted as `/store/{name}/` with read or readwrite permission.

**Agent discovery**: `list_agents` tool returns all agents; `get_task_run` tool checks async run status.

### System Prompt Architecture (Three Layers)

The assembled system prompt has three layers with distinct ownership:

1. **Agent prompt** (Layer 1) — The agent's task description (`agent.system_prompt` DB field). Agent-editable via `update_agent` tool, guided by `self_improvement` skill. Structured as Task/Output/Boundaries.
2. **Memory** (Layer 2) — AGENTS.md procedural memory wrapped in `<agent_memory>` tags. Agent-editable via `save_agents_md` tool. Contains: Communication, Patterns, Standards, Corrections. Memory guidelines live in the `self_improvement` skill (not the system prompt).
3. **System context** (Layer 3) — Deterministic, slim sections: Capabilities, Rules (dedup + token budget), Context (date/tz/user/memory capture). Dynamic data (item types, lists, approval settings) is available via tools and skills, not baked into the prompt.

Built by `buildPrompt()` in `src/agent/build-agent.ts`.

### AGENTS.md (Procedural Memory)

AGENTS.md is the agent's operating notes about how to serve a specific user — communication preferences, behavioral patterns, quality standards, and corrections. Stored in `agents_md_versions` DB table (not on disk), scoped per agent.

- **`src/agent/tools/get-agents-md.ts`** — Returns current AGENTS.md content and token budget for the calling agent.
- **`src/agent/tools/save-agents-md.ts`** — Writes full AGENTS.md content as new version (max 8000 chars). Prunes old versions, invalidates agent cache.
- **Seeding**: `create_agent` tool auto-seeds an empty AGENTS.md with section scaffolding (Communication, Patterns, Standards, Corrections)

### Self-Improvement Loop

The agent edits **two things** during self-improvement:

1. **AGENTS.md** (Layer 2, how to serve the user) — via `save_agents_md`. Updated in real-time by `self_improvement` skill during conversation, and weekly by `self_reflect` skill.
2. **`agent.system_prompt`** (Layer 1, what the agent does) — via `update_agent`. Only when task-level patterns are clear across 3+ session notes.

**Layer 3 (system context) is not agent-editable** — it's assembled deterministically by `buildPrompt()` from settings (date, timezone, user name, memory capture flag, capabilities, rules).

**The loop:**
- Real-time: user corrects agent → `self_improvement` skill fires → agent updates AGENTS.md immediately (first action, before responding) → also creates `session_note` item
- Weekly: `self_reflect` skill (Sunday 3am, cron) → searches `session_note` items since last run → cross-session synthesis → surgical AGENTS.md updates → optionally updates `system_prompt` if 3+ notes support a task-level change
- Maintenance: `memory_maintenance` skill (Sunday 4am) → merges duplicate items (>0.8 similarity), archives stale items (>90 days unreinforced), resolves contradictions
- Skip optimization: `skip_when_empty_type: "session_note"` on the self_reflect schedule → zero LLM cost when no new notes exist

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
- **Dedup**: Only for knowledge types (`preference`, `learned_fact`, `pattern`) in `create_item`. Threshold 0.95 → reinforce existing item (`last_reinforced_at`) instead of creating duplicate. `batch_create_items` bypasses dedup. The capture skill also instructs the agent to search at 0.85 before creating.

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

### Sandbox / Code Execution

Agents with the `execute` tool get a `SecureSandbox` wrapping `@langchain/node-vfs` VfsSandbox. Controlled by `sandbox_provider` setting (`none`, `node-vfs`, `daytona`, `deno` — only `node-vfs` is currently implemented).

Security layers:
- Shell injection prevention (blocks `$`, backticks, `;`, `&&`, `||`, `|`)
- Global command denylist (env, sudo, kill, ssh, package managers, shell spawning)
- Optional skill-level command allowlist via `allowed-commands` frontmatter
- Environment sanitization (only HOME, PATH, NODE_ENV, TERM, LANG forwarded)

**Not a security boundary** — VfsSandbox has no process/filesystem isolation. For untrusted agents, use a container-based provider (Daytona, Docker) — the schema supports it but implementations are not yet built.

### Semantic Search Details

`searchItems()` in `packages/db/src/items.ts` implements two-phase retrieval:

1. **Candidate retrieval**: Cosine similarity filter `1 - (embedding <=> query) > threshold` (default 0.65). Fetches `limit * 3` candidates for re-ranking headroom.
2. **Re-ranking**: Applies exponential time decay `similarity * exp(-ln2 * age / half_life)` where `half_life` is per-type configurable (default 30 days). `last_reinforced_at` resets the decay clock. Optional boosts for authorship and type.

Superseded items (`superseded_by IS NOT NULL`) are excluded by default.

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
