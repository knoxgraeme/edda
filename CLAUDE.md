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
- **`src/agent/backends.ts`** — CompositeBackend factory: `/skills/` (progressive disclosure), `/store/` (own namespace), cross-agent store mounts (`metadata.stores`), optional `/workspace/` (env-gated `metadata.filesystem`)
- **`src/agent/skill-loader.ts`** — Loads `SKILL.md` content and `allowed-tools` metadata from disk by skill name (with caching)
- **`src/agent/tools/`** — Tool definitions (each exports a Zod schema)
- **`src/llm/index.ts`** — LLM provider factory (reads from `settings` DB table; supports Anthropic, OpenAI, Google, Groq, Ollama, Mistral, Bedrock)
- **`src/embed/index.ts`** — Embedding provider factory (Voyage, OpenAI, Google)
- **`src/skills/`** — Modular agent capabilities: `capture`, `context_refresh`, `daily_digest`, `manage`, `memory_catchup`, `post_process`, `recall`, `type_evolution`, `weekly_reflect`
- **`src/cron/standalone.ts`** — Standalone cron runner; reads `agents` table for schedules, creates `task_run` records, syncs dynamically
- **`src/cron/semaphore.ts`** — Concurrency limiter (async-mutex) for parallel agent execution
- **`src/notifications/index.ts`** — Creates notification items for agent run completions/failures
- **`src/checkpointer/index.ts`** — State checkpointing backend (postgres, sqlite, or memory)
- **`src/utils/sanitize-error.ts`** — Strips internal details from errors before returning to agents
- **`src/evals/`** — Vitest-based evaluation suite

### Frontend (`apps/web`)

Next.js App Router with React 19.

- **`src/app/`** — Route pages: `/` (chat), `/dashboard`, `/entities`, `/inbox`, `/settings`, `/login`
- **`src/app/api/v1/`** — REST API routes (agents, task-runs, items, entities, threads, settings, dashboard, timeline, confirmations, mcp-connections)
- **`src/middleware.ts`** — Next.js middleware; enforces optional password auth via `EDDA_PASSWORD`
- **`src/lib/auth.ts`** — Session token helpers (HMAC-based cookie auth)
- **`src/providers/`** — `ChatProvider` and `ClientProvider` context providers
- **`src/app/hooks/`** — Custom React hooks
- **`src/components/ui/`** — Shared UI primitives

### Database Package (`packages/db`)

Single source of truth for data model and queries.

- **`src/types.ts`** — Core types: `Settings`, `Item`, `Entity`, `ItemType`, `McpConnection`, `AgentsMdVersion`, `Agent`, `TaskRun`
- **`src/index.ts`** — PostgreSQL connection pool and re-exports
- **`src/agents.ts`** — CRUD for agents (create, update, delete, list, getScheduled)
- **`src/task-runs.ts`** — Task run lifecycle (create, start, complete, fail, getRecent)
- **`migrations/`** — Ordered SQL migration files (001–036); applied via `pnpm migrate`
- Key tables: `settings`, `item_types`, `items` (with pgvector embeddings), `entities`, `mcp_connections`, `agents_md_versions`, `agents`, `task_runs`

### Configuration Strategy

LLM provider, model, embedding provider, and feature flags are stored in the **`settings` database table** (not hardcoded). The factory functions in `src/llm/` and `src/embed/` read from this table at runtime. Use `pnpm db:seed-settings` to populate defaults.

Critical env vars (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `LLM_PROVIDER` / `LLM_MODEL` — defaults to `anthropic` / `claude-sonnet-4-20250514`
- `EMBEDDING_PROVIDER` — defaults to `voyage`
- `CRON_RUNNER` — `standalone` or `platform`
- `CHECKPOINTER` — `postgres`, `sqlite`, or `memory`
- `EDDA_PASSWORD` — optional; set to enable password-gated web UI (leave empty for local dev)
- `ALLOW_FILESYSTEM_ACCESS` — set to `true` to enable per-agent filesystem access (requires `FILESYSTEM_ROOT`)
- `FILESYSTEM_ROOT` — absolute path root for agent filesystem mounts (e.g. `/data`)

Notable DB settings (in `settings` table):
- `default_agent` — Name of the agent to use as the default conversational agent (default: `edda`)
- `task_max_concurrency` — Max parallel agent executions (default: 3)
- `notification_targets` — Where to send agent notifications (default: [inbox])

### Agents (Multi-Agent System)

Edda uses a unified multi-agent architecture. All agents are built by `buildAgent(agent)` — there is no separate orchestrator factory. A `default_agent` setting (default: `edda`) determines which agent serves as the conversational interface. Any agent can be the default.

- **`agents`** table — Single source of truth for all agents (system + user-created). Each row defines: name, description, system_prompt, skills[], tools[], subagents[], schedule (cron expression), context_mode, trigger, model_settings_key, enabled flag, metadata. Agents can declare `metadata.hooks` (`pre_invoke`/`post_invoke`) to customize cron runner behavior via a closed allowlist.
- **`task_runs`** table — Tracks every agent execution with full lifecycle: pending → running → completed/failed. Records trigger source, duration, token usage, output summary, and errors
- **Context modes**: `isolated` (unique thread per run), `daily` (shared thread per day), `persistent` (single shared thread)
- **Tool scoping**: Each agent's tools are resolved additively — union of `allowed-tools` from SKILL.md frontmatter across all skills, plus any individual tools in `agent.tools[]`. Empty = all tools (backward compatible). Each SKILL.md declares its required tools via `allowed-tools` YAML frontmatter.
- **`metadata.stores`** — Cross-agent store access. Keys are agent names (or `"*"` for wildcard), values are `"read"` or `"readwrite"`. Example: `{ "daily_digest": "read", "*": "read" }`.
- **`metadata.filesystem`** — Env-gated filesystem access. Requires `ALLOW_FILESYSTEM_ACCESS=true` and `FILESYSTEM_ROOT`. Example: `{ "path": "exports", "mode": "read" }`. Path is relative to `FILESYSTEM_ROOT`.

**Built-in system agents** (seeded in migration 029):
| Agent | Schedule | Skills | Context |
|---|---|---|---|
| daily_digest | 7am daily | daily_digest | daily |
| memory_catchup | 10pm daily | memory_catchup | isolated |
| weekly_reflect | Sunday 3am | weekly_reflect | daily |
| type_evolution | on-demand | type_evolution | isolated |
| context_refresh | 5am daily | context_refresh | isolated |
| memory_writer | subagent (orchestrator) | post_process | isolated |

### AGENTS.md (User Context Document)

The agent's knowledge of the user lives in a curated document called AGENTS.md, stored in the `agents_md_versions` DB table (not on disk). Each row is a complete version with content, the deterministic template used to produce it, and an input hash for change detection. Supports per-agent variants via `agent_name` column.

- **`src/agent/generate-agents-md.ts`** — Core logic: `buildDeterministicTemplate()` queries raw data from DB, `buildTemplateDiff()` computes changes, `maybeRefreshAgentsMd()` stores template+hash on every conversation (fast, no LLM), `runContextRefreshAgent()` spawns a subagent to curate content (cron only)
- **`src/agent/tools/save-agents-md.ts`** — Schema-only tool bound to the context_refresh subagent (not in main agent's tool set). The real DB write happens in `runContextRefreshAgent()`
- **`src/agent/build-agent.ts:buildPrompt()`** — Reads latest AGENTS.md content from DB via `getAgentsMdContent()` and embeds it in the system prompt
- **Cron**: `context_refresh` runs daily (default 5am), controlled by `settings.context_refresh_cron`
- **Change detection**: SHA-256 hash of the deterministic template; post-process path skips if hash matches, with a 30-second in-memory cache to avoid repeated DB queries

### Memory System

Memory is entity-based, not file-based. The `post_process` skill extracts knowledge (preferences, learned facts, patterns) and entities (person, project, company, etc.) from conversation transcripts into items and entity profiles.

- **`get_entity_profile` tool** — Dynamically assembles a complete entity profile from `entities` + linked `items`; always fresh, no cron needed
- **`post_process` skill** — Extracts implicit knowledge from conversations; deduplicates via semantic similarity (reinforce ≥0.95, supersede 0.85–0.95, create new otherwise)
- **`memory_catchup` agent** — Runs nightly; iterates unprocessed threads and invokes `post_process` for each

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
