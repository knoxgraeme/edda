# Edda vs Hermes Agent: Architectural Comparison

A code-level comparison of Edda (knoxgraeme/edda) and Hermes Agent (NousResearch/hermes-agent v0.8.0).

---

## At a Glance

| Dimension | Edda | Hermes Agent |
|---|---|---|
| **Language** | TypeScript (Node.js) | Python |
| **Runtime** | deepagents + LangGraph + LangChain | Custom agent loop (OpenAI/Anthropic SDKs directly) |
| **Architecture** | Full-stack monorepo (server + web UI + DB + CLI) | CLI-first tool with gateway addon |
| **Database** | PostgreSQL + pgvector | SQLite (sessions) + flat files (memory, skills) |
| **Memory** | 3-layer (items/pgvector + checkpointer + AGENTS.md) | 2-layer (MEMORY.md/USER.md files + context compression) |
| **Frontend** | Next.js web app (11 routes, 30+ API endpoints) | Terminal UI (rich REPL with multiline editing) |
| **LLM Providers** | 17+ via LangChain | OpenAI-compatible + Anthropic + custom routing |
| **Channel Adapters** | 3 (Telegram, Discord, Slack) | 15+ (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, email, SMS, iMessage, DingTalk, Feishu, WeCom, Mattermost, Home Assistant, webhooks) |
| **Execution Backends** | VfsSandbox (Node.js) | 6 backends (local, Docker, Modal, SSH, Singularity, Daytona) |
| **Multi-Agent** | Async delegation + sync subagents + cross-agent stores | Delegate tool (max depth 2, up to 3 concurrent children) |
| **Skills** | 14 built-in, DB-stored | 26+ categories, filesystem-based, community hub |
| **License** | Proprietary | MIT |

---

## Where Hermes Agent Is More Powerful

### 1. Terminal/Execution Backends (Hermes wins significantly)

Hermes has **6 execution backends**: local, Docker, Modal (serverless), SSH, Singularity, and Daytona. Each has full lifecycle management — creation locks, idle cleanup threads, background process tracking, resource limits (CPU, memory, disk), and per-task environment isolation.

Edda has **1 backend**: `VfsSandbox` from `@langchain/node-vfs`, wrapped with `SecureSandbox` for shell injection prevention. It's described in its own source as "a guardrail, not a security boundary." No Docker, no remote execution, no cloud sandboxes.

**Gap:** This is Hermes's biggest advantage. For coding/DevOps agent use cases, Edda would need container-based execution to be competitive.

### 2. Platform/Channel Coverage (Hermes wins significantly)

Hermes supports **15+ platforms** including WhatsApp, Signal, Matrix, email, SMS, iMessage, DingTalk, Feishu, WeCom, Mattermost, and Home Assistant — plus a generic webhook adapter and an API server mode. Each platform gets specific prompt hints for markdown rendering and media handling.

Edda supports **3 platforms**: Telegram, Discord, Slack. All three are mature (~500 lines each) with streaming delivery, but the coverage gap is large.

**Gap:** Hermes covers the global messaging landscape. Edda covers Western developer-focused platforms. Hermes also has a documented `ADDING_A_PLATFORM.md` guide, suggesting a mature adapter pattern.

### 3. Smart Model Routing (Hermes wins)

Hermes has `smart_model_routing.py` — a complexity classifier that routes simple messages to cheap models and complex ones to the primary model. It analyzes message length, code blocks, URLs, and keywords to decide routing. This is cost-optimization at the routing layer.

Edda has per-agent model overrides but **no dynamic routing**. Every message to an agent uses that agent's configured model regardless of complexity.

### 4. Mixture of Agents (Hermes wins)

Hermes has a `mixture_of_agents_tool` that fans out a query to 4 frontier models in parallel (Claude, Gemini, GPT, DeepSeek), then synthesizes responses with an aggregator. This is novel for hard reasoning tasks.

Edda has **nothing equivalent**. Multi-agent in Edda is about task delegation, not ensemble reasoning.

### 5. Dangerous Command Approval (Hermes wins on depth)

Hermes has ~30 dangerous command patterns, Unicode normalization (defeats fullwidth obfuscation), ANSI stripping, a "smart mode" that uses an auxiliary LLM for risk assessment, permanent allowlists persisted to config, and gateway-aware async approval queues.

Edda has `interrupt-wrapper.ts` (78 lines) with per-tool interrupt levels (always/suggest/never) and DB-backed pending actions. It's simpler and covers tool-level approval, but lacks Hermes's command-level pattern matching and LLM-assisted risk assessment.

### 6. RL Training Integration (Hermes wins — unique)

Hermes has a full `environments/` directory integrating with the Atropos RL framework. It includes `HermesAgentLoop` for multi-turn agent execution, SWE-bench style environments, and benchmark harnesses. This enables training models on agent trajectories.

Edda has **no RL training infrastructure**. Its eval suite is Vitest-based and focuses on output quality, not model training.

### 7. Voice/Media (Hermes wins — unique)

Hermes has `transcription_tools.py`, `tts_tool.py`, `voice_mode.py`, `vision_tools.py`, and `image_generation_tool.py`. It can do speech-to-text, text-to-speech, image generation, and vision analysis.

Edda has **no voice or media generation capabilities**.

### 8. Skill Ecosystem (Hermes wins on breadth)

Hermes has **26 skill categories** covering domains from red-teaming to smart-home to gaming to social-media. Skills are filesystem-based with a community hub (`skills_hub.py`, `skills_sync.py`), environment variable capture for credentials, and platform compatibility filtering.

Edda has **14 skills** focused on personal knowledge management (capture, recall, self-reflect, memory-maintenance, etc.). Skills are DB-stored and tightly scoped with frontmatter-based tool allowlists.

---

## Where Edda Is More Powerful

### 1. Structured Knowledge / Memory System (Edda wins significantly)

Edda has a **3-layer memory system** backed by PostgreSQL + pgvector:

- **Knowledge layer**: typed items with 1024-dim embeddings, semantic search with time-decay re-ranking, deduplication, entity linking, lists, and a full knowledge graph (`entities` + `item_entities` junction)
- **History layer**: LangGraph checkpointer with configurable thread lifetimes (ephemeral/daily/persistent)
- **Operating notes**: versioned AGENTS.md with structured sections (Communication, Patterns, Standards, Corrections)

Hermes has **flat-file memory**: `MEMORY.md` (2,200 char budget) and `USER.md` (1,375 char budget) with substring-based add/replace/remove operations. No embeddings, no semantic search, no entity linking, no knowledge graph, no typed items, no time-decay ranking. Memory is essentially a small scratchpad.

**Gap:** This is Edda's biggest advantage. Hermes memory is a fixed-size notepad. Edda memory is a structured, searchable, self-maintaining knowledge base with semantic retrieval.

### 2. Self-Improvement Loop (Edda wins significantly)

Edda has an automated learning cycle:
- Real-time: `self_improvement` skill updates AGENTS.md immediately when user corrects agent
- Session notes: agent creates `session_note` items capturing behavioral observations
- Weekly reflection: `self_reflect` skill analyzes session notes across sessions, updates operating notes
- Weekly maintenance: `memory_maintenance` skill merges duplicates, archives stale items, resolves contradictions

Hermes has **no automated self-improvement loop**. Memory writes are manual (agent decides to call `memory` tool). There's no periodic reflection, no cross-session pattern analysis, no contradiction resolution. The agent's learning is limited to what it explicitly saves to MEMORY.md within the character budget.

### 3. Database-Backed Architecture (Edda wins)

Edda uses PostgreSQL with **14 migrations**, typed tables (items, entities, item_types, agents, agent_schedules, task_runs, notifications, threads, channels, skills, etc.), and pgvector for semantic search. Everything is transactional and queryable.

Hermes uses SQLite for session tracking and flat files for everything else (memory, skills, config, cron jobs). No vector search, no relational schema for knowledge, no transactional guarantees across operations.

**Gap:** Edda's data model is production-grade. Hermes's is prototype-grade for knowledge management.

### 4. Web Frontend (Edda wins — Hermes has none)

Edda has a **full Next.js web application**: chat interface, agent management, dashboard, entity browser, inbox with confirmations/notifications/reminders, settings, and skills management. 11 routes, 30+ REST API endpoints.

Hermes is **CLI-only** with a rich terminal UI (multiline editing, slash commands, autocomplete). The gateway provides API server mode, but there's no web dashboard or management UI.

### 5. Multi-Agent Collaboration (Edda wins on depth)

Edda has:
- **Async delegation**: `run_agent` tool (fire-and-forget, task_run tracking)
- **Sync delegation**: deepagents native `task` tool (blocks, returns inline)
- **Cross-agent store access**: `metadata.stores` with read/readwrite permissions and wildcard mounting
- **Cross-agent notifications**: agents can notify each other passively or trigger immediate runs
- **Agent discovery**: `list_agents`, `get_task_run` tools
- **Per-agent tool scoping**: via skill frontmatter
- **Agent CRUD**: create, update, delete agents at runtime

Hermes has:
- **Delegate tool**: spawns child agents with restricted toolsets, max depth 2, max 3 concurrent
- **No cross-agent state sharing** beyond parent passing context in the delegation prompt
- **No agent persistence** — subagents are ephemeral, no DB-backed agent registry

### 6. Notification System (Edda wins — Hermes has minimal)

Edda has a **full notification system**: inbox with 3 tabs (confirmations, notifications, reminders), multi-target routing (inbox/agent/announce), scheduled reminders with cron/interval recurrence, atomic claim-based delivery, crash recovery, and per-schedule notification configuration.

Hermes has **cron job scheduling** (create/list/remove/pause/resume/trigger) but no inbox, no notification routing, no reminders, no agent-to-agent messaging, no delivery receipts.

### 7. Approval/Confirmation System (Edda wins on breadth)

Edda's approval system spans **5 entity types**: items, entities, item_types, telegram pairings, platform pairings. It has a unified inbox UI, per-tool interrupt levels with agent-specific overrides, TTL-based expiration, and bulk approve/reject.

Hermes has strong **command-level** approval but no approval flow for knowledge operations, entity creation, or type evolution.

### 8. Type Evolution (Edda wins — unique)

Edda has `type_evolution` skill: automatically clusters untyped items by embedding similarity, proposes new item types, respects approval settings, maintains type system hygiene (max 30 types, overlap detection). This is a self-organizing knowledge taxonomy.

Hermes has **no type system** — memory entries are untyped text strings.

---

## Where They Overlap

### Skills System
Both use progressive disclosure — skills loaded on demand, not dumped into context. Both have SKILL.md/frontmatter metadata. Hermes has filesystem-based skills with community sync; Edda has DB-stored skills with frontmatter tool scoping. Both support ~similar operations (list, view, install).

### MCP Integration
Both support MCP servers with stdio and HTTP transports, tool prefixing to avoid collisions, environment sanitization, and OAuth. Hermes has slightly more mature reconnection (exponential backoff, dynamic tool discovery via notifications). Edda has SSRF prevention and encoded-IP blocking that Hermes lacks.

### Cron/Scheduling
Both have cron scheduling with file/DB-backed job definitions, 60-second polling intervals. Edda's is more integrated (per-agent schedules, skip-when-empty optimization, notification delivery on completion). Hermes's is simpler but functional.

### Context Management
Both handle context window pressure. Hermes uses `ContextCompressor` (LLM-based summarization of middle messages, tool result pruning). Edda uses `contextEditingMiddleware` (clears old tool results at 80k tokens, keeps last 5 messages). Different approaches — Hermes summarizes, Edda truncates.

### Security
Both have command denylist/allowlist patterns, environment variable sanitization, and prompt injection detection. Hermes goes deeper on command-level security (Unicode normalization, smart LLM approval). Edda goes deeper on SSRF prevention and MCP security.

---

## Quality & Maturity Comparison

### Code Maturity

| Dimension | Edda | Hermes |
|---|---|---|
| **Architecture coherence** | High — unified agent builder, single DB, clean layer separation | Medium — pragmatic accretion of features, some scattered state |
| **Type safety** | TypeScript strict mode, Zod schemas on all tools | Python with runtime type hints, JSON schemas for tools |
| **Database design** | Production-grade (PostgreSQL, 14 migrations, indexes, constraints) | Lightweight (SQLite sessions, flat files for state) |
| **Error handling** | Structured (Pino logging, error serializers, sanitization) | Practical (try/except with logging, graceful degradation) |
| **Testing** | Vitest eval suite, type-checking CI | pytest with integration test markers |
| **Monorepo structure** | Clean (pnpm workspaces, Turbo, shared packages) | Flat Python project (single pyproject.toml) |

### Product Maturity

| Dimension | Edda | Hermes |
|---|---|---|
| **Target user** | Personal knowledge management power user | Developer/hacker/power user (coding, DevOps, research) |
| **Deployment model** | Self-hosted server (Docker Compose) | Local CLI + optional gateway service |
| **State management** | Centralized (PostgreSQL) | Distributed (files + SQLite + config.yaml) |
| **UI** | Web app + chat platforms | Terminal + chat platforms |
| **Documentation** | CLAUDE.md (comprehensive) | Dedicated docs site (hermes-agent.nousresearch.com) |
| **Community** | Single-maintainer | Nous Research team + open-source community |
| **Versioning** | Pre-release (0.0.1) | Active releases (0.8.0, multiple RELEASE_v*.md) |

### Strengths Summary

**Edda is a better "second brain"** — if the goal is long-term personal knowledge management with semantic search, entity linking, self-improving memory, and a web UI for browsing/managing knowledge, Edda is significantly more capable.

**Hermes is a better "coding agent"** — if the goal is executing complex terminal tasks across multiple environments (Docker, cloud, SSH), with multi-model reasoning, voice I/O, and broad platform reach, Hermes is significantly more capable.

### Architectural Quality

Edda has **higher architectural coherence**. The unified agent builder pattern, clean three-layer prompt architecture, and PostgreSQL-backed state management show intentional design. The codebase reads like a product with a clear vision.

Hermes has **more features but more accretion**. The 53 tool files, 15+ platform adapters, and 6 execution backends show rapid feature growth. Individual components are well-implemented (the MCP client, approval system, and terminal tool are particularly solid), but the overall architecture is more pragmatic than principled.

### Where to Learn from Hermes

1. **Execution backends** — Edda should consider Docker/container-based sandboxing as a non-trivial upgrade path
2. **Smart model routing** — routing simple messages to cheap models is a pragmatic cost optimization
3. **Context compression** — LLM-based summarization (Hermes) may preserve more signal than truncation (Edda) for long conversations
4. **Platform adapter breadth** — Hermes's `ADDING_A_PLATFORM.md` pattern could accelerate Edda's channel growth
5. **Mixture of Agents** — ensemble reasoning across multiple LLMs is a unique capability worth considering for high-stakes queries
