# Plan: Migrate to deepagents Native HITL + Split AGENTS.md Sections

Two independent improvements that can be shipped sequentially or in parallel.

---

## Part 1: Migrate Tool Approvals to deepagents HITL

### Goal

Replace the custom interrupt-wrapper + pending_actions system with deepagents'
native `interruptOn` configuration. Tool approvals become blocking graph
interrupts that resume cleanly, instead of async-only fire-and-forget with
synthetic message injection.

### Current Architecture

**Six files implement the custom system:**

| File | Lines | Role |
|---|---|---|
| `apps/server/src/agent/interrupt-wrapper.ts` | 79 | Wraps tools with DynamicStructuredTool that creates DB rows |
| `apps/server/src/agent/execute-approved-action.ts` | 79 | Finds original tool, executes it, injects result into thread |
| `apps/server/src/agent/resolve-action.ts` | 86 | Orchestrates resolve: DB update + channel surface edit + execute |
| `packages/db/src/pending-actions.ts` | 120 | CRUD for pending_actions table |
| `packages/db/migrations/008_pending_actions.sql` | 22 | Table schema |
| `packages/db/src/types.ts` (lines 482-502) | 20 | PendingAction type |

**Current flow:**

1. `buildAgent()` calls `wrapInterruptibleTools()` — replaces `"always"` tools with wrappers
2. Agent calls gated tool → wrapper creates `pending_actions` row → returns JSON to agent
3. Agent tells user "awaiting approval" → agent turn ends
4. User approves via inbox API / channel button → `resolveAndNotify()` called
5. `executeApprovedAction()` finds the original unwrapped tool, invokes it
6. If thread_id exists, injects result as synthetic user message via `agent.invoke()`

**Problems with current approach:**

- Tool result is injected as a fake user message, not in the original tool call slot
- Agent gets a broken tool call chain (wrapper returned `{interrupted: true}`, real result arrives later as "user" message)
- If thread is ephemeral, result is lost entirely
- Two parallel approval systems exist: `pending_actions` (tool interrupts) and `confirmations.ts` (entity/type/pairing approvals) — confusing

### Target Architecture

**deepagents `interruptOn` config:**

```typescript
// In buildAgent(), replace wrapInterruptibleTools() with:
createDeepAgent({
  // ...existing config...
  interruptOn: buildInterruptConfig(agent),
});

function buildInterruptConfig(agent: Agent) {
  const overrides = agent.metadata?.interrupt_overrides ?? {};
  const config: Record<string, { allowedDecisions: string[] }> = {};

  for (const [toolName, level] of Object.entries({
    ...toolInterruptDefaults,
    ...overrides,
  })) {
    if (level === "always") {
      config[toolName] = { allowedDecisions: ["approve", "reject"] };
    }
  }
  return config;
}
```

**New flow:**

1. `buildAgent()` passes `interruptOn` to `createDeepAgent()` — no tool wrapping
2. Agent calls gated tool → deepagents HITL middleware calls `interrupt()` → graph suspends → state persisted to checkpointer
3. Stream/invoke returns with `__interrupt__` signal containing tool name, args, decisions
4. Server detects interrupt → creates lightweight `pending_approvals` row → surfaces to user (inbox + channel buttons)
5. User approves → server sends `Command(resume="approve")` to the thread
6. Graph resumes from exact suspension point → tool executes → result flows into original slot → agent continues naturally

### Prerequisite: Verify deepagents HITL Works

Before building anything, validate the feature works on current deepagents version.

**Spike task:**

1. Create a test script that builds a minimal agent with `interruptOn` for one tool
2. Invoke the agent, confirm `__interrupt__` is returned
3. Resume with `Command(resume="approve")`, confirm tool executes and agent continues
4. If this fails (per issue #131), file/check upstream and stop — keep current system

If the spike succeeds, proceed with the migration.

### Migration Steps

#### Step 1: New lightweight table

```sql
-- Migration: 013_pending_approvals.sql
CREATE TABLE IF NOT EXISTS pending_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name    TEXT NOT NULL,
  thread_id     TEXT NOT NULL,       -- required (graph state lives in checkpointer)
  tool_name     TEXT NOT NULL,
  tool_args     JSONB NOT NULL DEFAULT '{}',  -- for display only, not re-execution
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  channel_refs  JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_approvals_status ON pending_approvals(status) WHERE status = 'pending';
CREATE INDEX idx_pending_approvals_thread ON pending_approvals(thread_id, status);
```

Key difference from `pending_actions`: no `run_context` or `tool_input` for re-execution.
The checkpointer holds the suspended state. This table is only for surfacing to UI/channels
and tracking TTL.

#### Step 2: Detect interrupts in server endpoints

**`apps/server/src/server/index.ts`** — stream endpoint:

After `agent.streamEvents()` completes, check for interrupt signal. If present:
- Parse tool name, args, allowed decisions from the interrupt payload
- Create `pending_approvals` row
- Send the interrupt metadata as an SSE event to the frontend
- Send channel buttons via `sendActionPrompt()` on linked channels

**`apps/server/src/channels/handle-message.ts`** — channel inbound:

After `streamToAdapter()`, check for interrupt. If present:
- Create `pending_approvals` row
- Call `adapter.sendActionPrompt()` with the approval info

#### Step 3: Resume endpoint

**New or modified endpoint**: `POST /api/pending-approvals/{id}/resolve`

```typescript
async function handleResolveApproval(id, decision, resolvedBy) {
  // 1. Atomic DB update (same pattern as today)
  const approval = await resolvePendingApproval(id, decision, resolvedBy);
  if (!approval) return null; // already resolved

  // 2. Update channel surfaces (remove buttons)
  await updateChannelSurfaces(approval, decision, resolvedBy);

  // 3. Resume the graph
  if (decision === "approved") {
    const agent = await getOrBuildAgent(approval.agent_name);
    await agent.invoke(
      { messages: [] },
      {
        configurable: { thread_id: approval.thread_id },
        command: { resume: "approve" },
      },
    );
  }
  // If rejected, graph stays suspended; thread can be abandoned or restarted
}
```

#### Step 4: Update channel adapters

Minimal change — `sendActionPrompt()` interface stays the same but receives a
`PendingApproval` instead of `PendingAction`. The callback handler calls the new
resolve endpoint instead of `resolveAndNotify()`.

For each adapter (telegram.ts, discord.ts, slack.ts):
- Update callback data format: `pa:approve:{approvalId}` (same pattern)
- On callback: call new `resolveAndNotify()` that sends `Command(resume=...)`

#### Step 5: Update inbox

The Confirmations tab currently shows `getPendingItems()` results (entity/type/pairing
approvals from `confirmations.ts`). Tool-level approvals are only in the REST API.

Option A: Add tool approvals to the inbox Confirmations tab alongside entity approvals.
Option B: Keep them separate (channel-only for tool approvals, inbox for entity approvals).

Recommend Option A — unify all approvals in one place.

#### Step 6: Update build-agent.ts

```diff
- // 3d. Wrap interruptible tools
- const interruptOverrides = (agent.metadata?.interrupt_overrides ?? {}) as Record<...>;
- const interruptTtl = (agent.metadata?.interrupt_ttl as string) ?? "1 hour";
- tools = wrapInterruptibleTools(tools, {
-   defaults: toolInterruptDefaults,
-   overrides: interruptOverrides,
-   agentName: agent.name,
-   ttl: interruptTtl,
- });

  // (tools no longer wrapped — interruptOn passed to createDeepAgent instead)

  return createDeepAgent({
    name: agent.name,
    model,
    tools,
    systemPrompt,
    checkpointer,
    store,
    backend,
    subagents,
    skills: ["/skills/"],
    middleware,
+   interruptOn: buildInterruptConfig(agent),
  });
```

#### Step 7: Expiry job

Add to `cron.ts` sync cycle (already runs every 5 minutes):

```typescript
await expirePendingApprovals(); // UPDATE SET status='expired' WHERE status='pending' AND expires_at <= now()
```

Suspended graph threads with expired approvals just stay suspended in the
checkpointer. They'll be cleaned up by normal checkpointer TTL (if configured)
or can be ignored — they don't consume runtime resources.

#### Step 8: Delete old system

After migration is verified:
- Delete `interrupt-wrapper.ts`
- Delete `execute-approved-action.ts`
- Delete `resolve-action.ts`
- Remove `wrapInterruptibleTools` import from `build-agent.ts`
- Deprecate `pending_actions` table (don't drop immediately — leave for rollback)
- Remove `pending-actions.ts` DB queries
- Clean up `PendingAction` type

### Rollback Plan

Keep the `pending_actions` table and old code on a branch. If deepagents HITL
proves unreliable in production, revert `build-agent.ts` to use
`wrapInterruptibleTools()` again. The two systems are independent — switching
back is a config change, not a data migration.

### Not in scope

- Entity/type/pairing confirmations (`confirmations.ts`, `getPendingItems()`) — these
  are a separate system with different semantics (confirmed boolean on DB rows).
  They don't use tool interrupts and are unaffected by this migration.
- `"suggest"` interrupt level — this is prompt-level guidance only, never enforced.
  No change needed.

---

## Part 2: Split AGENTS.md into Sections

### Goal

Replace the monolithic AGENTS.md blob with per-section storage so the agent can
atomically update one section (e.g. corrections) without rewriting the entire
document. Reduces risk of accidental data loss during real-time self-improvement.

### Current Architecture

**Storage:** `agents_md_versions` table — one row per complete version.

```sql
agents_md_versions (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,        -- entire document
  agent_name TEXT NOT NULL,
  created_at TIMESTAMPTZ
)
```

**Tools:**
- `get_agents_md` → returns full content string + token budget
- `save_agents_md` → writes full content as new version, prunes old versions, invalidates cache

**Document structure** (by convention, not enforced):
```markdown
## Communication
...
## Patterns
...
## Standards
...
## Corrections
...
```

**Problem:** Every update rewrites all sections. A real-time correction update
during conversation must read the whole document, modify one line in Corrections,
and write the whole thing back. Risk of losing stable Communication/Patterns content
if the LLM makes an editing mistake.

### Target Architecture

**New table** for per-section storage (primary source of truth):

```sql
-- Migration: 014_agents_md_sections.sql

CREATE TABLE agents_md_sections (
  id          SERIAL PRIMARY KEY,
  agent_name  TEXT NOT NULL,
  section     TEXT NOT NULL
              CHECK (section IN ('communication', 'patterns', 'standards', 'corrections')),
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_name, section)
);

-- Seed sections for all existing agents
INSERT INTO agents_md_sections (agent_name, section, content)
SELECT DISTINCT agent_name, s.section, ''
FROM agents_md_versions
CROSS JOIN unnest(ARRAY['communication', 'patterns', 'standards', 'corrections']) AS s(section)
ON CONFLICT DO NOTHING;
```

**Keep `agents_md_versions`** for full-document version history. Every section
write also snapshots the assembled document as a new version.

### Migration Steps

#### Step 1: Migration SQL + data backfill script

**SQL migration** (`014_agents_md_sections.sql`): Creates table, seeds empty sections.

**TypeScript backfill** (run once after migration): For each agent's latest
`agents_md_versions` row, parse the content by `## {Section}` headers and populate
`agents_md_sections`. Parsing logic:

```typescript
function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const pattern = /^## (Communication|Patterns|Standards|Corrections)\s*$/gim;
  let lastSection: string | null = null;
  let lastIndex = 0;

  for (const match of content.matchAll(pattern)) {
    if (lastSection) {
      sections[lastSection] = content.slice(lastIndex, match.index).trim();
    }
    lastSection = match[1].toLowerCase();
    lastIndex = match.index! + match[0].length;
  }
  if (lastSection) {
    sections[lastSection] = content.slice(lastIndex).trim();
  }
  return sections;
}
```

#### Step 2: Update DB query layer

**`packages/db/src/agents-md.ts`** — add section functions:

```typescript
/** Get a single section's content. */
export async function getAgentsMdSection(
  agentName: string,
  section: string,
): Promise<string> { ... }

/** Upsert a single section. Returns the assembled full content. */
export async function saveAgentsMdSection(
  agentName: string,
  section: string,
  content: string,
): Promise<string> {
  // 1. UPSERT the section row
  // 2. Assemble full content from all sections
  // 3. Save snapshot to agents_md_versions (for history)
  // 4. Return assembled content
}

/** Assemble full AGENTS.md from sections (ordered). */
export async function assembleAgentsMd(agentName: string): Promise<string> {
  const rows = await pool.query(
    `SELECT section, content FROM agents_md_sections
     WHERE agent_name = $1
     ORDER BY CASE section
       WHEN 'communication' THEN 1
       WHEN 'patterns' THEN 2
       WHEN 'standards' THEN 3
       WHEN 'corrections' THEN 4
     END`,
    [agentName],
  );
  return rows
    .filter(r => r.content.trim())
    .map(r => `## ${capitalize(r.section)}\n\n${r.content}`)
    .join('\n\n');
}
```

**Modify `getAgentsMdContent()`** — switch to read from sections:

```typescript
export async function getAgentsMdContent(agentName = "edda"): Promise<string> {
  // Try sections first (new system)
  const assembled = await assembleAgentsMd(agentName);
  if (assembled) return assembled;

  // Fallback to legacy versions table (migration not yet run)
  const latest = await getLatestAgentsMd(agentName);
  return latest?.content ?? "";
}
```

#### Step 3: New tool — `save_agents_md_section`

**`apps/server/src/agent/tools/save-agents-md-section.ts`:**

```typescript
export const saveAgentsMdSectionSchema = z.object({
  section: z.enum(["communication", "patterns", "standards", "corrections"])
    .describe("Which section to update"),
  content: z.string().min(1).max(2000)
    .describe("New content for this section (replaces existing)"),
});

// Implementation:
// 1. Call saveAgentsMdSection(agentName, section, content)
// 2. invalidateAgent(agentName)
// 3. Return { saved: true, section, length }
```

#### Step 4: Update existing `save_agents_md` tool

Keep it working. When called, also sync sections:

```typescript
// After saving to agents_md_versions, parse sections and update agents_md_sections
const sections = parseSections(content);
for (const [section, sectionContent] of Object.entries(sections)) {
  await saveAgentsMdSection(agentName, section, sectionContent);
}
```

This keeps both storage layers in sync regardless of which tool the agent uses.

#### Step 5: Register new tool + update skills

**`apps/server/src/agent/tools/index.ts`** — add `saveAgentsMdSectionTool` to `allTools`.

**`apps/server/skills/self-improvement/SKILL.md`** — add to `allowed-tools`:

```yaml
allowed-tools:
  - update_agent
  - list_agents
  - save_agents_md
  - save_agents_md_section   # new
  - get_agents_md
```

Update the skill body to guide usage:

```markdown
## Updating Memory

For **targeted updates** during conversation, prefer `save_agents_md_section`:
- User corrects output format → `save_agents_md_section("standards", "...")`
- Communication preference → `save_agents_md_section("communication", "...")`
- Behavioral pattern → `save_agents_md_section("patterns", "...")`
- Specific mistake → `save_agents_md_section("corrections", "...")`

Read the current section first via `get_agents_md` to avoid overwriting entries.
Make surgical additions — don't rewrite the entire section.

For **bulk rewrites** (multiple sections changing at once), use `save_agents_md`
with full content.
```

**`apps/server/skills/self-reflect/SKILL.md`** — no change. Self-reflect does
holistic rewrites and should continue using `save_agents_md`.

#### Step 6: Settings

```sql
-- In the same migration or a separate one
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS agents_md_section_budget INTEGER NOT NULL DEFAULT 1000;
```

Update `get_agents_md` tool to return per-section budgets in addition to total.

#### Step 7: Agent creation seeding

**`apps/server/src/agent/tools/create-agent.ts`** — when seeding a new agent's
AGENTS.md, also create the four section rows:

```typescript
// After saving the initial agents_md_version scaffold
for (const section of ['communication', 'patterns', 'standards', 'corrections']) {
  await saveAgentsMdSection(agentName, section, '');
}
```

### Backwards Compatibility

- `save_agents_md` keeps working — syncs to sections table
- `get_agents_md` keeps working — assembles from sections (falls back to versions)
- `buildPrompt()` is unchanged — calls `getAgentsMdContent()` which returns the same string
- `agents_md_versions` keeps accumulating snapshots for version history
- Existing AGENTS.md content is migrated by the backfill script

### Not in scope

- Custom section names (user-defined sections beyond the four standard ones)
- Per-section write permissions (e.g. "user can edit communication, agent can only edit corrections")
- Section-level version history (use full-document snapshots in agents_md_versions)
- UI for editing sections (future — currently agents self-manage)

---

## Sequencing

These two migrations are independent. Recommended order:

1. **AGENTS.md sections first** — lower risk, no external dependency, immediate
   benefit to self-improvement reliability
2. **HITL migration second** — depends on deepagents spike succeeding, higher
   complexity, but bigger architectural improvement

Both can be developed in parallel on separate branches.
