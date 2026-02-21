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
- **`src/agent/`** — Agent factory, tool definitions, system prompt builder, and middleware
- **`src/llm/index.ts`** — LLM provider factory (reads from `settings` DB table; supports Anthropic, OpenAI, Google, Groq, Ollama, Mistral, Bedrock)
- **`src/embed/index.ts`** — Embedding provider factory (Voyage, OpenAI, Google)
- **`src/skills/`** — Modular agent capabilities: `capture`, `daily_digest`, `manage`, `memory_extraction`, `recall`, `type_evolution`, `user_crons`, `weekly_reflect`
- **`src/cron/`** — Scheduled task runner; can run as `standalone` (node-cron) or `platform` (LangGraph Platform), controlled by env
- **`src/checkpointer/index.ts`** — State checkpointing backend (postgres, sqlite, or memory)
- **`src/evals/`** — Vitest-based evaluation suite

### Frontend (`apps/web`)

Next.js App Router with React 19.

- **`src/app/`** — Route pages: `/` (chat), `/dashboard`, `/entities`, `/inbox`, `/settings`
- **`src/providers/`** — `ChatProvider` and `ClientProvider` context providers
- **`src/app/hooks/`** — Custom React hooks
- **`src/components/ui/`** — Shared UI primitives

### Database Package (`packages/db`)

Single source of truth for data model and queries.

- **`src/types.ts`** — Core types: `Settings`, `Item`, `Entity`, `ItemType`, `McpConnection`
- **`src/index.ts`** — PostgreSQL connection pool and re-exports
- **`migrations/`** — Ordered SQL migration files (001–007); applied via `pnpm migrate`
- Key tables: `settings`, `item_types`, `items` (with pgvector embeddings), `entities`, `mcp_connections`

### Configuration Strategy

LLM provider, model, embedding provider, and feature flags are stored in the **`settings` database table** (not hardcoded). The factory functions in `src/llm/` and `src/embed/` read from this table at runtime. Use `pnpm db:seed-settings` to populate defaults.

Critical env vars (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `LLM_PROVIDER` / `LLM_MODEL` — defaults to `anthropic` / `claude-sonnet-4-20250514`
- `EMBEDDING_PROVIDER` — defaults to `voyage`
- `CRON_RUNNER` — `standalone` or `platform`
- `CHECKPOINTER` — `postgres`, `sqlite`, or `memory`

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
