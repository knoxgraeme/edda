# Edda Architecture Audit

Code-level audit of Edda's core features. Based on reading the actual source code, not the README.

## 1. Deep Agents Runtime

Edda uses [`deepagents`](https://www.npmjs.com/package/deepagents) (v1.7.0) as its core agent runtime, built on top of LangGraph and LangChain. The entire agent lifecycle flows through a single factory function.

### Agent Build Pipeline

**`buildAgent(agent: Agent)`** — `apps/server/src/agent/build-agent.ts:349-497`

Every agent (conversational, scheduled, on-demand) is built by the same code path. Differences come from DB configuration, not code branches. The build steps:

1. **Model resolution** — `getModelString()` / `resolveModel()` from `src/llm.ts`
2. **Tool gathering** — built-in tools + MCP tools + community tools + search tool (all parallel)
3. **Tool scoping** — union of `allowed-tools` from skill frontmatter + `agent.tools[]` + always `list_my_runs`
4. **Schema normalization** — Anthropic `type: "object"` fix, Gemini schema workarounds
5. **Interrupt wrapping** — tool-level approval defaults (always/suggest/never) with per-agent overrides
6. **Sandbox creation** — if scoped tools include `execute`, creates `SecureSandbox`
7. **Subagent resolution** — `resolveSubagents()` builds scoped SubagentSpec for each
8. **Skills writing** — SKILL.md files written to LangGraph BaseStore for progressive disclosure
9. **System prompt** — three-layer builder (agent prompt + AGENTS.md memory + system context)
10. **Backend assembly** — CompositeBackend with `/skills/`, `/store/`, cross-agent mounts
11. **Middleware stack** — limits, retry, context editing, lazy tools

Final call:
```ts
createDeepAgent({
  name, model, tools, systemPrompt,
  checkpointer, store, backend, subagents,
  skills: ["/skills/"],
  middleware,
});
```

### What deepagents provides vs LangChain/LangGraph

**deepagents:**
- `createDeepAgent()` — agent runtime (replaces direct StateGraph/createReactAgent usage)
- `CompositeBackend` — virtual filesystem mounts (`/skills/`, `/store/`, cross-agent stores)
- `StoreBackend` — wraps LangGraph's BaseStore as file-like backend
- `SandboxBackendProtocol` — sandboxed code execution interface
- Progressive disclosure — SKILL.md files loaded on-demand, not dumped into context
- Native `task` tool — synchronous subagent delegation (auto-injected when subagents present)
- Lazy tools middleware — skill-specific tools only visible when skill is active

**LangChain/LangGraph (used under deepagents):**
- `BaseStore` (PostgreSQL persistence), checkpointing
- `StructuredTool`, `LanguageModelLike` interfaces
- Provider packages: `@langchain/anthropic`, `@langchain/openai`, `@langchain/google-genai`, etc.
- `langchain` middleware: `toolCallLimitMiddleware`, `contextEditingMiddleware`, `modelRetryMiddleware`

### LLM Resolution

`apps/server/src/llm.ts`:
- `getModelString()` returns `provider:model` strings for `initChatModel`
- `resolveModel()` directly instantiates classes for providers not in LangChain's registry (OpenRouter, Minimax, etc.)
- Provider/model stored in DB `settings` table; per-agent overrides via `agents.model_provider` / `agents.model`
- 17+ providers: Anthropic, OpenAI, Google, Groq, Ollama, Mistral, Bedrock, xAI, DeepSeek, Cerebras, Fireworks, Together, Azure, OpenRouter, Minimax, Moonshot, ZhipuAI

### Middleware Stack

`apps/server/src/agent/middleware.ts`:
- `toolArgNormalizerMiddleware` — normalizes common arg aliases
- `toolCallLimitMiddleware` — per-run tool call cap (default 30)
- Per-tool limits via `metadata.middleware.toolLimits`
- `modelCallLimitMiddleware` — hard safety stop (default 15)
- `contextEditingMiddleware` — clears old tool results when context exceeds 80k tokens
- `modelRetryMiddleware` — exponential backoff for 429/500/503
- `createLazyToolsMiddleware` — hides skill-specific tools until skill is active

---

## 2. Memory System

Three complementary memory layers:

### Layer 1: Knowledge (Items + pgvector)

The `items` table is the primary knowledge store.

**Key columns:** `type` (references item_types), `content`, `summary`, `embedding` (vector(1024)), `day` (calendar anchor), `status` (active/done/archived/snoozed), `superseded_by`, `last_reinforced_at`.

**Embedding pipeline** (`apps/server/src/embed.ts`):
- Text format: `"${type}: ${content}${summary}. [list: ${listName}]"`
- Pluggable providers: Voyage, OpenAI, Google (configured in DB settings)
- Batch embedding with 96-item chunks

**Semantic search** (`packages/db/src/items.ts:searchItems()`):
- Two-phase: candidate retrieval (cosine similarity > 0.65) → re-ranking with exponential time decay
- Decay: `similarity * exp(-ln2 * age / half_life)` with per-type half-life (default 30 days)
- `last_reinforced_at` resets the decay clock
- 3x candidate over-fetch for re-ranking headroom

**Deduplication** (`apps/server/src/agent/tools/create-item.ts`):
- Only for knowledge types: `preference`, `learned_fact`, `pattern`
- Threshold 0.95 → reinforce existing item instead of creating duplicate
- `batch_create_items` bypasses dedup for performance

**Entity system** (knowledge graph):
- `entities` table: person, project, company, topic, place, tool, concept
- `item_entities` junction: relationships (mentioned, about, assigned_to, decided_by)
- `get_entity_profile` tool dynamically assembles profile from entity + linked items

### Layer 2: History (Checkpointer)

Thread state persistence via LangGraph checkpointing (`apps/server/src/checkpointer.ts`).

Backends: PostgreSQL (default), SQLite, in-memory.

Thread ID resolved per `agent.thread_lifetime`:
- **ephemeral**: `task-{name}-{uuid}` — new thread every run
- **daily**: `task-{name}-{YYYY-MM-DD}` — shared per day
- **persistent**: `task-{name}` — single thread forever
- Optional per-channel suffix: `-{platform}:{channelId}`

### Layer 3: Operating Notes (AGENTS.md)

Procedural memory — how the agent should behave for a specific user.

- Stored in `agents_md_versions` table (not on disk), versioned, scoped per agent
- Injected into system prompt as `<agent_memory>` block
- Token budget: default 4000, max 8000 chars
- Sections: Communication, Patterns, Standards, Corrections

### The Self-Improvement Loop

1. **Real-time** (`self_improvement` skill): during conversation, agent immediately updates AGENTS.md when user corrects it or expresses preferences

2. **Session notes**: agent creates `session_note` items capturing observations during conversation

3. **Scheduled reflection** (`self_reflect` skill, Sunday 3am): searches session_notes since last run, identifies patterns across sessions, surgically updates AGENTS.md. Skipped (zero LLM cost) when no new notes via `skip_when_empty_type`.

4. **Maintenance** (`memory_maintenance` skill, Sunday 4am): merges near-duplicates (>0.8 similarity), archives stale items (>90 days unreinforced), resolves contradictions, consolidates entity descriptions.

### Capture Skill

When `memory_capture=true` on an agent, the `capture` skill extracts implicit knowledge (preferences, facts, patterns) inline during natural conversation. Lightweight: 1-2 tool calls per turn.

---

## 3. Cross-Agent Collaboration & Context Sharing

### Async Delegation: `run_agent` tool

`apps/server/src/agent/tools/run-agent.ts` — fire-and-forget:
- Creates `task_run` record with `trigger: "agent"`
- Executes target in background with concurrency limiting (`task_max_concurrency`, default 3)
- Returns `task_run_id` immediately; caller polls via `get_task_run`

### Sync Delegation: `task` tool (deepagents native)

When agent has `subagents[]`, deepagents injects a native `task` tool:
- Blocks until subagent completes, returns result inline
- Each subagent gets its own scoped tools, skills, model, system prompt
- Resolved at build time via `resolveSubagents()` (`build-agent.ts:175-231`)

System prompt guidance:
> Delegation: `task` (synchronous subagent, returns result inline) vs `run_agent` (async, returns task_run_id)

### Cross-Agent Store Access

`apps/server/src/agent/backends.ts` — declarative store mounting via `metadata.stores`:
```json
{ "daily_digest": "read", "*": "read" }
```
- Each agent's `/store/` is namespaced by agent name
- Cross-agent mounts appear as `/store/{agent_name}/`
- `"read"` → ReadOnlyStoreBackend, `"readwrite"` → full access
- Wildcard `"*"` mounts all other enabled agents

### Cross-Agent Notifications

- `send_notification` with `target: "agent:<name>"` — passive (read on next run)
- `target: "agent:<name>:active"` — triggers immediate agent run consuming the notification

### Scheduled Runs

`apps/server/src/cron.ts`:
- Before executing, fetches agent's unread notifications and prepends to prompt
- After completion, delivers results to configured `notify` targets

### Agent Discovery

- `list_agents` — all agents with name, description, trigger, skills
- `get_task_run` — status, output_summary, duration, error of async runs

---

## 4. Notifications & Inbox

### Central Routing

`apps/server/src/utils/notify.ts` — all notifications flow through `notify()`.

| Target | Behavior |
|---|---|
| `inbox` | DB row visible in web UI |
| `agent:<name>` | Passive — agent reads on next run |
| `agent:<name>:active` | Triggers immediate agent run |
| `announce:<name>` | Delivers to agent's channels (Telegram/Discord/Slack) — zero LLM cost |

**Status lifecycle:**
- Standard: `unread` → `read` → `dismissed`
- Reminders: `scheduled` → `sending` → `sent` (or back to `scheduled` for recurring)

### Reminders

`apps/server/src/agent/tools/create-reminder.ts`:
- Creates notification with `status: 'scheduled'`, `scheduled_at` in UTC
- Timezone-aware input conversion
- Two recurrence formats: cron expressions, PostgreSQL intervals (5-min minimum)

**Polling** (`cron.ts`):
- Every 60s, `claimDueReminders()` atomically fetches due rows (`FOR UPDATE SKIP LOCKED`)
- One-shot → `'sent'` (terminal); recurring → advance to next date
- Crash recovery: `resetStuckSendingReminders()` reverts stuck rows on startup

### Web Inbox

`apps/web/src/app/inbox/inbox-client.tsx` — three tabs:
1. **Confirmations** — pending item types, entities, user pairings (approve/reject)
2. **Notifications** — unread notifications from agent runs (dismiss)
3. **Reminders** — upcoming scheduled reminders (cancel)

---

## 5. Additional Core Features

### Skills System (Progressive Disclosure)

Skills are SKILL.md files stored in DB, written to BaseStore at `/{skillName}/SKILL.md`. The deepagents runtime loads them on-demand — the agent reads from `/skills/` as needed.

Each SKILL.md has YAML frontmatter:
```yaml
---
name: capture
allowed-tools:
  - create_item
  - search_items
allowed-commands:
  - node
---
```

Tool scoping is additive: union of all skill `allowed-tools` + `agent.tools[]`.

14 built-in skills: admin, agent-creation, capture, coding, daily-digest, manage, memory-maintenance, recall, reminders, self-improvement, self-reflect, skill-management, type-evolution, weekly-report.

### MCP Integration

`apps/server/src/mcp/client.ts`:
- Singleton `MultiServerMCPClient` shared across agents
- Transports: stdio, SSE, streamable-http
- Tools prefixed: `mcp__${serverName}__${toolName}`
- SSRF prevention: blocks private/encoded IPs, non-http schemes
- Env sanitization for stdio: only HOME, PATH, NODE_ENV, TERM, LANG
- OAuth (PKCE) for remote servers, tokens encrypted at rest (AES-256-GCM)

### Channel Adapters

`apps/server/src/channels/`:
- **Telegram** (grammY, webhook), **Discord** (discord.js, WebSocket), **Slack** (@slack/bolt, Socket Mode)
- Inbound: platform → `paired_users` access check → channel→agent resolution → thread resolution → streaming response
- Streaming delivery: debounced progressive edits (1/sec, 50 char min), fallback to full-send
- Announcement channels receive output directly without invoking agent

### Confirmation/Approval System

Unified across items, entities, item_types, and user pairings.
- `getPendingItems()` aggregates all pending confirmations for inbox
- Settings: `approval_new_entity` (auto/confirm), `approval_new_type` (auto/confirm)

### Sandbox Code Execution

`apps/server/src/agent/sandbox.ts` — `SecureSandbox` wrapping `VfsSandbox`:
- Shell injection prevention (blocks `$`, backticks, `;`, `&&`, `||`, `|`)
- Global command denylist (env, sudo, kill, ssh, package managers, shells)
- Skill-level command allowlist (optional)
- Environment sanitization
- Note: guardrail, not security boundary

### Type Evolution

`type-evolution` skill (monthly cron): analyzes untyped `note` items, clusters by embedding similarity, proposes new item types for clusters >= 5 items. Caps at 30 total types.

### Three Built-in System Agents

| Agent | Skills | Thread | Schedules |
|---|---|---|---|
| edda | capture, recall, manage, admin, self_improvement, self_reflect, reminders | persistent | self_reflect (Sun 3am) |
| digest | daily_digest, weekly_report | daily | daily_digest (7am), weekly_report (Sun 6pm) |
| maintenance | type_evolution, memory_maintenance | ephemeral | type_evolution (monthly), memory_maintenance (Sun 4am) |
