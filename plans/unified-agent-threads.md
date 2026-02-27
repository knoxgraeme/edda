# Unified Agent Threads in the Web UI

## Problem

Today the web UI only talks to the **default agent** (edda). All other agents are invisible — they run via cron or `run_agent` tool calls and their conversations are buried in task run logs. The chat sidebar shows a flat list of threads with no indication of which agent they belong to.

This creates two problems:
1. **Background agents are opaque.** You can't see what maintenance, memory, or digest actually did without querying the DB.
2. **Non-default agents are unreachable.** If you create a custom agent, the only way to talk to it is via the `run_agent` tool through edda — there's no direct conversation interface.

## Design

Every agent gets its own thread space in the UI. The default agent is the primary conversational interface (top of sidebar), other agents appear below with their own threads.

### Sidebar Layout

```
┌─────────────────────────┐
│ + New chat               │
│                          │
│ ─── Edda (default) ──── │
│  Today                   │
│    Help me plan dinner   │
│    What's on my calendar │
│  Yesterday               │
│    Summarize that article│
│                          │
│ ─── Digest ──────────── │
│    Daily digest (Feb 26) │  ← daily thread, read-only
│    Weekly reflect (Feb 23)│
│                          │
│ ─── Maintenance ──────── │
│    Context refresh (2/26)│  ← ephemeral, one per run
│    Type evolution (2/26) │
│                          │
│ ─── Memory ──────────── │
│    Memory catchup (2/25) │
│                          │
│ ─── My Custom Agent ─── │
│    + New chat             │  ← can start conversations
│    Research project       │
└─────────────────────────┘
```

### Key Behaviors

| Agent type | Thread lifetime | UI behavior |
|---|---|---|
| Default (edda) | persistent | User creates threads freely via "New chat". Primary chat interface. |
| Cron agents (digest, maintenance, memory) | ephemeral/daily | Threads appear automatically after runs. Read-only by default — user can view but not inject messages. |
| User-created on-demand agents | any | User can start new conversations directly. Thread lifetime controls how threads are reused. |

### What Changes

**Current:** Single agent loaded at startup → all messages routed to it → flat thread list.

**After:** Server can route messages to any agent → threads tagged with agent name → sidebar groups by agent.

## Architecture

### Thread → Agent Association

`thread_metadata` currently has no concept of which agent owns a thread. We need to add `agent_name`.

```sql
ALTER TABLE thread_metadata ADD COLUMN agent_name TEXT;
CREATE INDEX idx_thread_metadata_agent ON thread_metadata(agent_name);

-- Backfill: existing threads belong to the default agent
UPDATE thread_metadata SET agent_name = (SELECT value FROM settings WHERE key = 'default_agent');
```

The server already writes `thread_metadata` rows via `upsertThread()` — we just need to pass the agent name through.

### Multi-Agent Server Routing

Currently the server loads one agent at startup and stores it in a module-level `agentState` singleton. To support multi-agent chat:

**Option A: Agent cache (recommended).** Keep the default agent pre-loaded. Lazy-load other agents on first request, cache with TTL. This avoids loading all agents at startup (some may never be used from the UI).

```typescript
// apps/server/src/server/index.ts

// Replace singleton agentState with a cache
const agentCache = new Map<string, { agent: Runnable; loadedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getOrBuildAgent(agentName: string): Promise<Runnable> {
  const cached = agentCache.get(agentName);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.agent;
  }
  const row = await getAgentByName(agentName);
  if (!row || !row.enabled) throw new Error(`Agent "${agentName}" not found or disabled`);
  const agent = await buildAgent(row);
  agentCache.set(agentName, { agent, loadedAt: Date.now() });
  return agent;
}
```

### Stream Endpoint Changes

The `/api/stream` request body gains an optional `agent_name` field:

```typescript
const StreamRequestSchema = z.object({
  messages: z.array(z.object({ content: z.string().min(1) })).min(1),
  thread_id: z.string().uuid(),
  agent_name: z.string().optional(), // NEW — defaults to settings.default_agent
});
```

The handler resolves the agent, then streams as before:

```typescript
const agentName = parsed.data.agent_name ?? settings.default_agent;
const agent = await getOrBuildAgent(agentName);
// ... rest of stream logic, but pass agentName to upsertThread
```

### Thread List Endpoint Changes

`GET /api/threads` gains optional `?agent_name=` query param:

```typescript
// Filter by agent
const agentName = url.searchParams.get("agent_name");
const rows = agentName
  ? await listThreadsByAgent(agentName, 50)
  : await listThreads(50);
```

New DB query in `packages/db/src/threads.ts`:

```typescript
export async function listThreadsByAgent(agentName: string, limit = 50) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT thread_id, title, agent_name, metadata, updated_at FROM thread_metadata
     WHERE agent_name = $1 ORDER BY updated_at DESC LIMIT $2`,
    [agentName, limit],
  );
  return rows;
}
```

### Thread ID Resolution for UI-Initiated Conversations

When the user starts a new chat with a non-default agent, the **client** should respect the agent's `thread_lifetime`:

| Thread lifetime | Behavior when user clicks "New chat" for this agent |
|---|---|
| `ephemeral` | Always create a fresh UUID — same as today |
| `daily` | Reuse today's thread (`task-{agent}-{YYYY-MM-DD}`), creating it if needed |
| `persistent` | Always reuse `task-{agent}` — there's only one thread |

This means the client needs to know the agent's `thread_lifetime` to compute the right thread ID. The agents list API already returns this field.

For `daily` and `persistent`, the client should check if a thread already exists (via the thread list) and load it rather than creating a new empty one.

## Migration

```sql
-- Add agent_name to thread_metadata
ALTER TABLE thread_metadata ADD COLUMN agent_name TEXT;
CREATE INDEX idx_thread_metadata_agent ON thread_metadata(agent_name);

-- Backfill existing threads to default agent
UPDATE thread_metadata
SET agent_name = (SELECT value FROM settings WHERE key = 'default_agent');
```

## Files to Update

### Phase 1: Thread → Agent Association (DB + Server)

- [ ] `packages/db/migrations/017_thread_agent_name.sql` — Migration above
- [ ] `packages/db/src/threads.ts` — Add `agent_name` param to `upsertThread()`, add `listThreadsByAgent()`, include `agent_name` in `listThreads()` response
- [ ] `packages/db/src/types.ts` — Update thread-related types if any
- [ ] `apps/server/src/server/index.ts` — Pass `agent_name` to `upsertThread()` in `handleStream()`, add `agent_name` to thread list response, support `?agent_name=` filter on `GET /api/threads`

### Phase 2: Multi-Agent Stream Routing (Server)

- [ ] `apps/server/src/server/index.ts` — Replace singleton `agentState` with agent cache, accept `agent_name` in stream request schema, resolve agent dynamically
- [ ] `apps/server/src/index.ts` — Pre-warm default agent in cache instead of setting singleton

### Phase 3: Sidebar Redesign (Web UI)

- [ ] `apps/web/src/app/hooks/useEddaThreads.ts` — Fetch threads grouped by agent (either multiple requests or single request with grouping)
- [ ] `apps/web/src/app/components/ThreadList.tsx` — Group threads by agent with collapsible sections, show agent name/description as section headers
- [ ] `apps/web/src/app/hooks/useEdda.ts` — Accept `agentName` param, pass it in stream request body
- [ ] `apps/web/src/providers/ChatProvider.tsx` — Track active agent in context, expose `setAgent()` for switching
- [ ] `apps/web/src/app/components/ChatPageClient.tsx` — Update sidebar to use new grouped thread list, update "New chat" to create thread for active agent

### Phase 4: Thread Lifetime Awareness (Web UI)

- [ ] `apps/web/src/app/hooks/useEdda.ts` — When switching to a `daily` or `persistent` agent, compute the correct thread ID instead of generating a random UUID
- [ ] `apps/web/src/app/components/ThreadList.tsx` — For cron agents, show threads as read-only (no "New chat" button for `ephemeral` cron agents since threads are created by the cron runner, not the user)

## Notes

- **No breaking API changes.** `agent_name` is optional on `/api/stream` — omitting it uses the default agent. Existing clients work unchanged.
- **Cron threads are already tagged.** `resolveThreadId()` produces `task-{agentName}-...` prefixed IDs, so we can backfill `agent_name` by parsing the prefix for threads that predate the migration.
- **Agent cache invalidation.** When an agent's config changes (skills, prompt, etc), the cache should be invalidated. The simplest approach: agents API PATCH route calls a cache-bust endpoint, or the cache TTL is short enough (5 min) that changes propagate naturally.
- **Read-only vs interactive.** Cron agent threads should be viewable but not writable from the UI by default. The user didn't start these conversations — the cron runner did. If we want to allow "reply to a cron thread," that's a future enhancement.
- **Memory extraction.** The `memory` agent processes threads via `getUnprocessedThreads()`. This already works with `thread_metadata` and doesn't filter by agent, so no changes needed there.
