# System Prompt & AGENTS.md Redesign

## Problem

The current system prompt and AGENTS.md have blurred responsibilities:
- **Duplication**: Item types, lists, approval settings, entities appear in both
- **AGENTS.md is undersized**: ~2000 token budget trying to hold identity, directives, entities, item types, settings, active context, boundaries, AND recall guides
- **AGENTS.md mirrors DB data**: The deterministic template is a flat dump of preferences, facts, patterns, entities — the "curator not transcriber" promise is undermined by the template structure
- **No procedural memory**: The agent has no mechanism to learn from corrections and improve its behavior over time
- **Agent creation produces weak system prompts**: Most agents get `"You are {name}, an Edda agent."` with no task-specific instructions
- **Agent prompt is static**: Once set at creation, the task description can't be refined by the agent itself — only by the user via `update_agent`

## Design Principles

The full prompt has **three layers** with distinct ownership:

1. **Agent prompt** = the agent's task description (agent-editable via tool)
2. **AGENTS.md** = procedural memory — how to serve this specific user (agent-curated)
3. **System context** = deterministic rules, capabilities, reference data (code-built, not editable)

Plus the existing knowledge systems:
4. **Items DB** = semantic memory — granular facts, preferences, entities (searched via tools)
5. **Skills** = task-specific instructions (progressive disclosure via /skills/)
6. **Store** = durable agent output

LangGraph memory taxonomy mapping:
| Memory Type | What It Stores | Edda Equivalent |
|---|---|---|
| **Semantic** | Facts about user/world | `items` table + pgvector search |
| **Episodic** | Past experiences | Conversation history (checkpointer) + task_runs |
| **Procedural** | Rules for how the agent operates | **AGENTS.md** + **agent prompt** |

---

## How deepagents `memory` param actually works

Key finding from source code analysis (deepagents v1.8.0):

The `memory` param takes an array of file paths (e.g. `["/AGENTS.md"]`). Under the hood:

1. **`createMemoryMiddleware`** loads content from the backend in `beforeAgent` hook
2. **`wrapModelCall`** injects content into the system prompt on every model call, wrapped in `<agent_memory>` XML tags
3. Content is **prepended before** the user's `systemPrompt` — so memory comes first in the prompt
4. The agent updates memory via the standard `edit_file` tool (filesystem operations)
5. Updates persist in the backend; next invocation picks up changes
6. Includes built-in `MEMORY_SYSTEM_PROMPT` with guidelines on when/how to update

**So `memory` and `systemPrompt` both end up in the system message** — the difference is that `memory` is runtime-editable and comes with built-in update guidelines.

### Decision: Keep DB storage with dedicated tools

We store AGENTS.md in Postgres (with versioning, hashing, pruning). The `memory` param expects backend-readable file paths. Two approaches:

**Option A — Bridge to backend:** Write AGENTS.md content from DB into the store backend on agent boot (like we already do for skills), then pass the path to `memory`. The agent edits via `edit_file`, and we sync changes back to DB via a middleware hook or post-processing step.

- Pro: Uses deepagents' native memory system — XML tagging, built-in guidelines, `edit_file` for updates
- Pro: No custom `save_agents_md` tool needed — the agent uses standard filesystem tools
- Con: Need to sync backend writes back to DB for versioning
- Con: Lose fine-grained versioning/pruning unless we add sync logic

**Option B — Keep current approach (recommended):** Continue injecting AGENTS.md into systemPrompt string and using `save_agents_md` tool. Add our own memory guidelines to the system prompt.

- Pro: DB versioning, hash-based change detection, and pruning all work as-is
- Pro: `save_agents_md` is a dedicated tool with validation (1-8000 chars, proper typing)
- Pro: No sync complexity — single source of truth in DB
- Pro: Same pattern works for agent prompt editing (dedicated tool, DB-backed)
- Con: Miss out on deepagents' native memory UX (XML tagging, built-in guidelines)

**Recommendation: Option B.** The deepagents memory system is designed for simpler file-based setups. Our DB-backed system with versioning is more robust, and the benefits of native memory (XML tags, built-in guidelines) are cosmetic — we can add equivalent guidance ourselves. Keeping a single source of truth in the DB avoids sync bugs. This also gives us a consistent pattern: both the agent prompt and AGENTS.md are DB-backed, tool-editable, and versioned.

---

## Assembled Prompt Structure

```
┌─────────────────────────────────────────────────────┐
│ LAYER 1: Agent Prompt (agent-editable)              │
│                                                     │
│ You are {agent.name}, an Edda agent.                │ ← identity (from name)
│                                                     │
│ ## Task                                             │
│ 1. Check inbox for unread emails                    │ ← agent.system_prompt
│ 2. Summarize each in 1-2 sentences                  │    field in DB.
│ 3. Flag action-required emails as tasks             │    Written at creation
│                                                     │    by orchestrator,
│ ## Output                                           │    refined over time
│ - Write daily summary to /store/{date}              │    by the agent itself
│ - Create task items for action-required emails      │    via update_agent tool
│                                                     │
│ ## Boundaries                                       │
│ - Never unsubscribe from senders in Key People      │
│ - Ask before deleting any email                     │
├─────────────────────────────────────────────────────┤
│ LAYER 2: Memory — AGENTS.md (agent-editable)        │
│                                                     │
│ <agent_memory>                                      │
│ ## Communication                                    │ ← agents_md_versions
│ - Prefers concise bullet points over prose          │    table in DB.
│ - Uses "lmk" to mean low priority                   │    Seeded at creation,
│                                                     │    updated in real-time
│ ## Patterns                                         │    via save_agents_md
│ - Batches admin tasks on Monday mornings            │    and weekly via
│                                                     │    self_reflection skill
│ ## Standards                                        │
│ - Summaries: 3 bullets max                          │
│ - Email digests: group by sender                    │
│                                                     │
│ ## Corrections                                      │
│ - Don't merge entities with same first name         │
│ - The Verge newsletter is NOT marketing             │
│ </agent_memory>                                     │
│                                                     │
│ <memory_guidelines>                                 │ ← Static, hard-coded
│ {when/how to update memory, memory vs items vs      │    in buildPrompt().
│  lists routing, examples}                           │    Same for all agents.
│ </memory_guidelines>                                │
├─────────────────────────────────────────────────────┤
│ LAYER 3: System Context (deterministic, firm)       │
│                                                     │
│ ## Capabilities                                     │ ← Hard-coded in
│ - Store: write durable output to /store/            │    buildPrompt()
│ - Skills: loaded on demand from /skills/            │
│ - Delegation: task vs run_agent [conditional]       │
│                                                     │
│ ## Rules                                            │ ← From settings table
│ - Approval: new types (confirm), archive (auto)     │
│ - Always search before creating duplicate items     │
│ - AGENTS.md token budget: 4000                      │
│                                                     │
│ ## Context                                          │ ← Computed at runtime
│ - Today: Wednesday, February 25, 2026               │    + from settings
│ - Timezone: America/New_York                        │
│ - User: Graeme                                      │
│                                                     │
│ ## Available Item Types                             │ ← From item_types table
│ - 📝 note: General notes                            │
│ - ✅ task: Action items                              │
│                                                     │
│ ## Common Metadata Fields                           │ ← Hard-coded reference
│ - recommended_by, url, category, priority, ...      │
│                                                     │
│ ## Active Lists                                     │ ← From lists table
│ - 🛒 Groceries (12 items)                           │
│ - 🎬 Movies to Watch (5 items)                      │
└─────────────────────────────────────────────────────┘
```

### What's editable vs firm

| Content | Source | Editable By | Via |
|---|---|---|---|
| Agent prompt (task/output/boundaries) | `agent.system_prompt` DB field | Agent itself | `update_agent` tool (guided by `self_improvement` skill) |
| AGENTS.md (communication/patterns/standards/corrections) | `agents_md_versions` table | Agent itself | `save_agents_md` tool (real-time + weekly reflection) |
| Memory guidelines | Hard-coded in `buildPrompt()` | Nobody (code only) | Code changes |
| Capabilities | Hard-coded in `buildPrompt()` | Nobody (code only) | Code changes |
| Rules (approval modes) | `settings` table | User | `update_settings` tool |
| Context (date, tz, user) | `settings` + runtime | System / user | Computed + `update_settings` |
| Item types | `item_types` table | Type evolution skill / user | DB |
| Lists | `lists` table | User via manage skill | DB |

---

## Phase 1: Restructure `buildPrompt()` + Agent Prompt Editability

### 1a. Restructure `buildPrompt()`

Split the current monolithic prompt into three clear layers:

**Current structure:**
```
base → AGENTS.md content → store instructions → context → delegation →
item types → common metadata fields → lists → approval settings → integrations
```

**New structure:**
```
Layer 1: agent.system_prompt (agent-editable task description)
Layer 2: ## Memory (<agent_memory> + <memory_guidelines>)
Layer 3: ## Capabilities → ## Rules → ## Context → ## Item Types → ## Metadata → ## Lists
```

**Key changes:**
- **Restructure**: `## About This User` becomes `## Memory` with XML-tagged content and guidelines
- **Add**: `## Capabilities` and `## Rules` as distinct sections
- **Remove**: `## External Integrations` — redundant; MCP tools and descriptions are already in the agent's tool list
- **Remove**: `## Persistent Store` as standalone section — folded into `## Capabilities`
- **Keep**: Item types, lists, metadata fields in system context — small, stable, frequently needed
- **Keep**: DB-backed AGENTS.md with `save_agents_md` tool

**Memory guidelines content** (injected as `<memory_guidelines>` in every prompt):

```xml
<memory_guidelines>
Your memory contains your operating notes about this user — communication
preferences, behavioral patterns, quality standards, and corrections.
Update it via save_agents_md.

**Learning from interactions:**
- One of your MAIN PRIORITIES is to learn from interactions with the user.
  Learnings can be implicit or explicit.
- When you need to remember something, updating memory must be your FIRST,
  IMMEDIATE action — before responding, before calling other tools.
- When the user says something is better/worse, capture WHY and encode it
  as a pattern. Look for the underlying principle, not just the specific mistake.
- Each correction is a chance to improve permanently — don't just fix the
  immediate issue, update your operating notes.
- The user might not explicitly ask you to remember something. If they provide
  information useful for future interactions, update immediately.

**When to update memory:**
- User explicitly asks you to remember something
- User describes how you should behave or what they prefer
- User gives feedback on your work — capture what was wrong and how to improve
- You discover patterns or preferences (communication style, format preferences, workflows)
- User corrects you — save the correction AND the underlying principle

**When to NOT update memory:**
- Transient information ("I'm running late", "I'm on my phone")
- One-time task requests ("find me a recipe", "what's the weather?")
- Simple questions, small talk, acknowledgments
- Factual information about the user (preferences, facts, entities) — these
  belong as items in the database, not in memory. Use create_item instead.
- Never store API keys, passwords, or credentials

**Memory vs Items — what goes where:**
- **Memory (AGENTS.md)**: How to serve this user — communication style, quality
  standards, corrections, behavioral patterns. Operating notes that shape every
  interaction.
- **Items (create_item)**: What the user knows/wants/has — facts, preferences,
  tasks, recommendations, entities. Granular knowledge searchable via
  search_items.
- **Lists (create_list + create_item)**: Grouped items the user wants to track
  together — reading lists, grocery lists, project tasks. Use lists when the
  user describes a collection of related things.

**Examples:**
User: "I prefer bullet points over paragraphs"
→ Update memory (communication style that shapes all future responses)

User: "I love Thai food, especially pad see ew"
→ Create item (preference/learned_fact — searchable for future recommendations)

User: "Here are the movies I want to watch: Inception, Interstellar, Arrival"
→ Create list "Movies to Watch" + create items for each movie

User: "That summary was way too long, keep it to 3 bullets max"
→ Update memory (quality standard + correction: "Summaries: 3 bullets max")

User: "Remember that Tom's birthday is March 15"
→ Create item (fact about an entity — searchable, linked to Tom)

User: "Actually don't auto-archive things, always ask me first"
→ Update memory (correction: explicit boundary about agent behavior)
</memory_guidelines>
```

### 1b. Make agent prompt editable via `update_agent`

The agent can already call `update_agent` to modify `system_prompt`. The missing piece
is a **skill** that teaches the agent when and how to refine its own task instructions.

**New skill: `self_improvement`**

```yaml
---
name: self_improvement
description: >
  Refine your own task instructions and operating notes. Use when you identify
  clearer ways to describe your workflow, output format, or boundaries.
  Also handles updating your procedural memory (AGENTS.md) with corrections,
  communication preferences, and quality standards.
allowed-tools:
  - update_agent
  - save_agents_md
  - get_context_diff
---
```

**Skill content:**

```markdown
# self_improvement

## When to Update Your Agent Prompt (system_prompt)
Your agent prompt defines WHAT you do — your task, output format, and boundaries.
Update it via update_agent(name=your_name, system_prompt=...) when:

- You realize your task description is incomplete or misleading
- The user asks you to change what you do (not just how — that's memory)
- You've been doing something consistently that isn't in your instructions
- Your output format has evolved and the prompt should reflect it

**Rules:**
- Read your current prompt first (list_agents to see it)
- Make surgical edits — don't rewrite from scratch
- Keep the ## Task / ## Output / ## Boundaries structure
- Never remove boundaries the user explicitly set

**Example:**
Agent discovers it should also flag calendar invites, not just emails:
→ update_agent(name="email_monitor", system_prompt="...updated with step 5: Flag calendar invites...")

## When to Update Your Memory (AGENTS.md)
Your memory defines HOW you serve this user — communication style, patterns, standards.
Update it via save_agents_md when:

- User corrects you or gives feedback
- User states a preference (explicit or implicit)
- You notice a pattern in how the user works

See <memory_guidelines> in your prompt for full details.

## Agent Prompt vs Memory — Which to Update?

| Signal | Update | Example |
|---|---|---|
| "Also check my spam folder" | Agent prompt (new task step) | Task scope change |
| "I prefer bullet points" | Memory (communication style) | How you present output |
| "Stop summarizing replies" | Agent prompt (boundary) | What you should NOT do |
| "That summary was too long" | Memory (quality standard) | How to calibrate quality |
| "Run this every morning at 8" | Agent prompt (output/schedule) | When/where to deliver |
| "Don't merge Tom entities" | Memory (correction) | Specific learned lesson |
```

### Files to modify (Phase 1)
- `apps/server/src/agent/build-agent.ts` — restructure `buildPrompt()` into three layers, add memory guidelines, remove integrations section
- `apps/server/src/__tests__/system-prompt.test.ts` — update assertions
- `apps/server/skills/self_improvement/SKILL.md` — new skill
- Migration — add `self_improvement` skill to DB, add to default agent's skills

---

## Phase 2: Reshape AGENTS.md as Procedural Memory

### Current AGENTS.md content (data mirror)
```
# Raw Template Data
User: {name}, Timezone: {tz}
## Preferences — flat list from items DB
## Known Facts — flat list from items DB
## Patterns — flat list from items DB
## Key Entities — flat list from entities DB
## Item Types — duplicates system prompt
## Settings — duplicates system prompt
```

### New AGENTS.md content (procedural memory)
```
## Communication
- {how the user prefers to receive information}
- {shorthand, tone preferences, format preferences}

## Patterns
- {recurring behaviors, rhythms, habits the agent has observed}
- {how the user typically works with the system}

## Standards
- {what "good output" looks like for this user}
- {quality expectations for summaries, tasks, captures}

## Corrections
- {specific things the user has told the agent to stop/start doing}
- {mistakes the agent made and should not repeat}
```

### Seeding
When an agent is created or on first run, seed a starter AGENTS.md:
```
## Communication
(Learning — will update as I observe your preferences)

## Patterns
(No patterns observed yet)

## Standards
(No specific standards established yet)

## Corrections
(No corrections yet)
```

For the default `edda` agent, include basic user context from settings:
```
## Communication
- User: {display_name}
- Timezone: {timezone}
(Learning — will update as I observe your preferences)
...
```

### Token budget
Increase from ~2000 to ~4000 tokens. The document is smaller in scope (no data dumps) but richer in synthesized insights.

### Files to modify
- `apps/server/src/agent/generate-agents-md.ts` — rework `buildDeterministicTemplate()` to produce a change signal, not a document structure
- `apps/server/skills/context_refresh/SKILL.md` — update workflow to match new AGENTS.md shape
- `packages/db/src/agents-md.ts` — update seeding logic
- Migration — update `agents_md_token_budget` default to 4000

---

## Phase 3: `session_summary` Item Type + Segment-Based Processing

### Purpose
Feed the weekly self-improvement pass with structured retrospective data from
each extraction pass — focused on what the agent learned about serving the user,
especially corrections and quality signals ("what went wrong").

### Key design decisions
- **Decoupled from sessions**: A `session_summary` is created per *processing pass*,
  not per conversation. Long-lived threads (daily/persistent context) get multiple
  summaries as new messages accumulate.
- **Watermark tracking**: Each summary stores `thread_id` and `message_count` in
  metadata. The message count serves as a watermark — next processing pass only
  extracts from messages after that position.
- **Corrections are highest value**: The structured `corrections` field is the
  primary input for self-improvement. Quality signals provide supporting context.

### Item type metadata
```json
{
  "thread_id": "UUID of the thread processed",
  "message_count": "total messages at time of processing (watermark)",
  "corrections": ["array of things user corrected"],
  "preferences_observed": ["array of new preferences noted"],
  "quality_signals": ["what went well or poorly"]
}
```

### Integration with `memory_extraction`
The skill now does incremental processing:
1. Before extracting, check for prior session summaries for the thread
2. Use `message_count` from the most recent summary as watermark
3. Only extract from messages after the watermark
4. Minimum segment size: 4 new messages
5. Create a new session summary with updated `message_count`

### Files modified
- `packages/db/migrations/011_session_summary_type.sql` — add item type
- `packages/db/migrations/013_session_summary_segment_support.sql` — update metadata schema
- `apps/server/skills/memory_extraction/SKILL.md` — segment-based processing + watermark

---

## Phase 4: Self-Improvement Folded into `weekly_reflect`

### Purpose
Weekly review of session summaries to identify trends and update AGENTS.md. This
is the primary mechanism for the agent to improve over time.

### Key design decision: Combined, not separate
Originally planned as a standalone `self_reflection` skill. Combined into
`weekly_reflect` instead because:
- Both read the past week's data — saves context/tokens doing it in one pass
- Activity analysis naturally leads into "what did I learn?"
- Avoids sequencing issues (reflect cleans data that self-improvement reads)

### `weekly_reflect` now has three parts
1. **Activity Analysis** — themes, entities, dropped threads, cross-session patterns
2. **Memory Maintenance** — dedup, archive stale, resolve contradictions, consolidate entities
3. **Self-Improvement** — analyze session summaries for corrections and quality signals,
   update AGENTS.md procedural memory, optionally refine agent prompts

### Self-improvement workflow (Part 3)
1. Search for `session_summary` items from the past week
2. Analyze corrections (highest priority), preferences, quality signals
3. Read current AGENTS.md via `get_context_diff`
4. Make surgical updates to Communication, Patterns, Standards, Corrections
5. Save via `save_agents_md`
6. If task-level patterns across 3+ summaries → optionally `update_agent`

### Files modified
- `apps/server/skills/weekly_reflect/SKILL.md` — expanded with Part 3 + self-improvement tools
- `packages/db/migrations/012_self_reflection_skill.sql` — (vestigial, cleaned up by 014)
- `packages/db/migrations/014_weekly_reflect_self_improvement.sql` — cleanup + updated schedule prompt

---

## Phase 5: Improve Agent Creation Flow

### Problem
`create_agent` takes an optional `system_prompt` string, but the admin skill gives no guidance on writing a good one. Most agents get the bare minimum.

### Solution
Update the **admin skill** with clear instructions for edda on how to generate a structured `system_prompt` when creating an agent. Also seed AGENTS.md on creation.

### System prompt template for new agents
```
You are {agent_name}, an Edda agent.

## Task
{numbered steps — exactly what this agent does each run}

## Output
{where results go — /store/, items, notifications}

## Boundaries
{what it should NOT do, edge cases}
```

### Agent creation seeds both system_prompt AND AGENTS.md
When `create_agent` is called:
1. Orchestrator generates a structured `system_prompt` following the template
2. Tool seeds an initial AGENTS.md for the new agent (empty procedural memory template)
3. New agent gets `self_improvement` skill by default so it can refine itself

### Files modified
- `apps/server/skills/admin/SKILL.md` — added "Writing System Prompts" section with template + examples
- `apps/server/src/agent/tools/create-agent.ts` — auto-adds `self_improvement` skill, seeds initial AGENTS.md
- `packages/db/src/agents-md.ts` — already supported agent_name-scoped seeding (no changes needed)

---

## Population Lifecycle

```
Agent Creation                    Every Invocation              Over Time
─────────────                     ────────────────              ─────────

User: "create an agent            buildPrompt() assembles:      In conversation:
 that monitors my email"          1. agent.system_prompt         - User corrects agent
       │                             (from DB — agent-editable)  - Agent calls save_agents_md
       ▼                          2. AGENTS.md from DB           - AGENTS.md updated immediately
edda generates:                      (agent-editable)            - If task-level: update_agent
- system_prompt (task desc)       3. Deterministic sections:
- seeds AGENTS.md (empty             - getSettings()             Weekly weekly_reflect (Part 3):
  template with sections)            - getItemTypes()            - Reviews session_summaries
- adds self_improvement skill        - getAllLists()              - Updates AGENTS.md sections
- creates agent row               4. Returns assembled prompt    - May refine agent prompt
       │                                                           if clear pattern emerges
       ▼
create_agent tool:
- Saves agent to DB
- Saves seed AGENTS.md
  to agents_md_versions
```

---

## Migration Summary

Migrations (in order):
1. `009_self_improvement_skill.sql` — Add `self_improvement` skill to edda agent, bump token budget to 4000
2. `010_missing_indexes.sql` — (unrelated)
3. `011_session_summary_type.sql` — Add `session_summary` item type (agent_internal, 30-day decay)
4. `012_self_reflection_skill.sql` — Add `self_reflection` to maintenance (vestigial, cleaned up by 014)
5. `013_session_summary_segment_support.sql` — Update metadata schema with thread_id/message_count
6. `014_weekly_reflect_self_improvement.sql` — Remove standalone self_reflection, update weekly_reflect prompt

---

## Implementation Order

1. **Phase 1** ✅: Restructure `buildPrompt()` + `self_improvement` skill
2. **Phase 2** ✅: Reshape AGENTS.md as procedural memory + updated context_refresh
3. **Phase 3** ✅: `session_summary` item type + segment-based memory_extraction
4. **Phase 4** ✅: Self-improvement folded into `weekly_reflect` (Part 3)
5. **Phase 5** ✅: Agent creation flow improvements

All phases complete.

---

## What This Achieves

**Before**: System prompt is a monolithic data dump. AGENTS.md mirrors the DB. Agent can't improve its own instructions. No mechanism to learn from corrections.

**After**:
- **Agent prompt** is a structured task description the agent can refine over time
- **AGENTS.md** is procedural memory the agent actively improves (communication, patterns, standards, corrections)
- **System context** is deterministic rules + reference data, rebuilt every run
- **Weekly self-improvement** (Part 3 of weekly_reflect) identifies trends from session retrospectives
- **Agent creation** produces well-structured prompts and seeds procedural memory
- Clear three-way split: agent prompt (what I do) → AGENTS.md (how I serve this user) → system context (rules + reference data)
