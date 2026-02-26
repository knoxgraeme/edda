# Rename `context_mode` → `thread_lifetime`

## Problem

`context_mode` is vague — it sounds like it controls context window behavior or agent permissions. What it actually controls is **how long a thread lives between runs**. The values are also unclear: `isolated` sounds like sandboxing, not "new thread every time."

## Change

Rename the column and update the enum values for clarity:

| Before | After | Meaning |
|---|---|---|
| `context_mode: "isolated"` | `thread_lifetime: "ephemeral"` | New thread every run |
| `context_mode: "daily"` | `thread_lifetime: "daily"` | Shared thread per day |
| `context_mode: "persistent"` | `thread_lifetime: "persistent"` | One thread, forever |

## Migration

```sql
-- Rename column
ALTER TABLE agents RENAME COLUMN context_mode TO thread_lifetime;

-- Update values
UPDATE agents SET thread_lifetime = 'ephemeral' WHERE thread_lifetime = 'isolated';

-- Update CHECK constraint
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_context_mode_check;
ALTER TABLE agents ADD CONSTRAINT agents_thread_lifetime_check
  CHECK (thread_lifetime IN ('ephemeral', 'daily', 'persistent'));

-- agent_schedules has an optional context_mode override — same rename
ALTER TABLE agent_schedules RENAME COLUMN context_mode TO thread_lifetime;
ALTER TABLE agent_schedules DROP CONSTRAINT IF EXISTS agent_schedules_context_mode_check;
ALTER TABLE agent_schedules ADD CONSTRAINT agent_schedules_thread_lifetime_check
  CHECK (thread_lifetime IS NULL OR thread_lifetime IN ('ephemeral', 'daily', 'persistent'));
```

## Files to Update

### Types
- `packages/db/src/types.ts` — Rename `AgentContextMode` → `ThreadLifetime`, update values to `"ephemeral" | "daily" | "persistent"`, update `Agent.context_mode` → `Agent.thread_lifetime`, update `AgentSchedule.context_mode` → `AgentSchedule.thread_lifetime`

### Server
- `apps/server/src/agent/build-agent.ts` — `resolveThreadId()`: rename references, change `"isolated"` case to `"ephemeral"`
- `apps/server/src/cron/local.ts` — Any references to `context_mode`

### DB queries
- `packages/db/src/agents.ts` — Column references in CRUD queries
- `packages/db/src/agent-schedules.ts` — Column references in CRUD queries

### Web UI
- `apps/web/src/app/agents/[name]/agent-detail-client.tsx` — Form fields, labels, select options
- `apps/web/src/app/agents/new/new-agent-client.tsx` — Form fields, labels, select options
- `apps/web/src/app/actions.ts` — Server actions referencing `context_mode`
- `apps/web/src/app/types/db.ts` — Frontend type mirrors (if separate from `@edda/db`)

### API routes
- `apps/web/src/app/api/v1/agents/` — Any routes that read/write `context_mode`

## Notes

- Pure rename — no behavioral change
- Should be done before or alongside the channels work since the channels plan references `thread_lifetime` and `thread_scope` together
- Grep for `context_mode` across the entire repo to catch any references
