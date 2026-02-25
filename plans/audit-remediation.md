# Edda Codebase Audit — Remediation Plan

## Context

A full codebase audit identified dead code, duplication, inconsistent error handling, and LangGraph best-practice gaps. The REST API layer (`/api/v1/`) is intentionally kept for future external integrations. This plan addresses all actionable findings, grouped by priority.

---

## P0 — Dead Code Removal

### 0.1 Remove `getMetadataValues()`
- **File:** `packages/db/src/items.ts:230-243`
- **What:** Delete the function. Never imported anywhere (not even tests).
- **Also:** Verify barrel export in `packages/db/src/index.ts` (auto-covered by `export *`).

### 0.2 Remove `getItemTypeByName()`
- **File:** `packages/db/src/item-types.ts:33-37`
- **What:** Delete the function. Only used in test mock (`apps/server/src/__tests__/helpers.ts:90`).
- **Also:** Update the test mock in `helpers.ts` to remove the mock for this function.

### 0.3 Remove `getEntitiesByName()` and `searchEntities()`
- **File:** `packages/db/src/entities.ts:83-90` (`getEntitiesByName`) and `92-139` (`searchEntities`)
- **What:** Delete both functions. Only used in DB integration tests.
- **Also:** Remove tests referencing them in `packages/db/src/__tests__/entities.test.ts` (lines ~105-150) and any mock references in `apps/server/src/__tests__/helpers.ts`.

### 0.4 Remove `Resizable` component
- **File:** `apps/web/src/components/ui/resizable.tsx` (43 lines)
- **What:** Delete the entire file. Never imported anywhere.
- **Also:** Check if `react-resizable-panels` can be removed from `apps/web/package.json` dependencies.

---

## P1 — Standardize Tool Error Handling

### 1.1 Convert JSON error returns to throws

6 tool files return JSON error objects instead of throwing, which confuses the agent (it can't distinguish error from success).

| File | Line | Current | Change to |
|------|------|---------|-----------|
| `apps/server/src/agent/tools/delete-item.ts` | 17 | `return JSON.stringify({ status: "not_found", item_id })` | `throw new Error(\`Item ${item_id} not found\`)` |
| `apps/server/src/agent/tools/update-item.ts` | 34 | `return JSON.stringify({ error: "Item not found", item_id })` | `throw new Error(\`Item ${item_id} not found\`)` |
| `apps/server/src/agent/tools/update-item.ts` | 47 | `return JSON.stringify({ error: "Item not found", item_id })` | `throw new Error(\`Item ${item_id} not found\`)` |
| `apps/server/src/agent/tools/get-task-result.ts` | 25 | `return JSON.stringify({ error: 'Task run not found' })` | `throw new Error(\`Task run ${task_run_id} not found\`)` |
| `apps/server/src/agent/tools/reject-pending.ts` | 20 | `return JSON.stringify({ status: "not_found", id })` | `throw new Error(\`Pending item ${id} not found\`)` |
| `apps/server/src/agent/tools/update-mcp-connection.ts` | 24 | `return JSON.stringify({ status: "not_found", id })` | `throw new Error(\`MCP connection ${id} not found\`)` |

**Rationale:** LangGraph best practices say tools should throw on failure so the framework can handle errors at the graph level. The agent receives a clean error message it can reason about.

---

## P1 — Type Safety in Agent Construction

### 1.2 Replace `any` types with proper types

4 instances of `any` across 2 files:

| File | Line | Current | Fix |
|------|------|---------|-----|
| `apps/server/src/agent/index.ts` | 83 | `additionalTools: any[], Promise<any>` | Use `StructuredToolInterface[]` for param, `CompiledGraph` or the actual deepagents return type for return |
| `apps/server/src/agent/build-agent.ts` | 71 | `store?: any` | Use `BaseStore` from `@langchain/langgraph` |
| `apps/server/src/agent/build-agent.ts` | 155 | `Promise<any>` | Use proper return type from `createDeepAgent` |

**Approach:** Import the correct types from `@langchain/langgraph` and `deepagents`. If the library types are generic/opaque, use the narrowest available type rather than `any`. Remove the `@typescript-eslint/no-explicit-any` disable comments.

---

## P1 — Extract `buildUpdateQuery` Helper

### 1.3 DRY up 5 identical update patterns

All 5 DB modules implement the same dynamic UPDATE pattern:

```typescript
const entries = Object.entries(updates).filter(([k]) => UPDATE_COLUMNS.includes(k));
const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
```

**Files:**
- `packages/db/src/items.ts` — `updateItem()` (lines 61-79)
- `packages/db/src/entities.ts` — `updateEntity()` (lines 58-75)
- `packages/db/src/agents.ts` — `updateAgent()` (lines 100-144) — has special `metadata` JSON serialization
- `packages/db/src/mcp-connections.ts` — `updateMcpConnection()` (lines 32-53)
- `packages/db/src/settings.ts` — `updateSettings()` (lines 75-88)

**New file:** `packages/db/src/query-helpers.ts`

```typescript
export function buildDynamicUpdate(
  table: string,
  id: string,
  updates: Record<string, unknown>,
  allowedColumns: readonly string[],
  options?: {
    idColumn?: string;           // default "id"
    idParamIndex?: number;       // default 1
    serializers?: Record<string, (v: unknown) => unknown>; // e.g. { metadata: JSON.stringify }
    returning?: string;          // default "*"
  }
): { sql: string; params: unknown[] } | null
```

- Returns `null` if no valid columns to update (callers handle gracefully)
- `agents.ts` passes `{ serializers: { metadata: JSON.stringify } }` for its special case
- Export from `packages/db/src/index.ts`
- ~30 lines of shared code, saves ~100 lines of duplication

---

## P2 — LangGraph Improvements

### 2.1 Per-agent configurable timeout

**Current:** Hardcoded `const AGENT_TIMEOUT_MS = 5 * 60 * 1000` in two places:
- `apps/server/src/agent/tools/run-agent.ts:19`
- `apps/server/src/cron/standalone.ts:58`

**Change:**
1. Add `timeout_ms` column to `agents` table (nullable integer, default NULL = use global default)
   - New migration: `036_agent_timeout.sql`
   - `ALTER TABLE agents ADD COLUMN timeout_ms integer;`
2. Add `timeout_ms` to `Agent` type in `packages/db/src/types.ts:306`
3. Add `timeout_ms` to `AGENT_UPDATE_COLUMNS` in `packages/db/src/agents.ts`
4. In `run-agent.ts` and `standalone.ts`: read `agent.timeout_ms ?? AGENT_TIMEOUT_MS` as the effective timeout
5. Extract the shared default constant to a common location (e.g. `packages/db/src/constants.ts` or inline in both files)

### 2.2 Validate skill `allowed-tools` at agent creation

**File:** `apps/server/src/agent/skill-loader.ts`

**Current:** `collectSkillTools()` (lines 62-81) collects tool names from SKILL.md files but never validates they exist in `TOOLS_BY_NAME`.

**Change:** Add a validation pass in `build-agent.ts` after collecting skill tools:
```typescript
import { allTools } from "./tools/index.js";
const validToolNames = new Set(allTools.map(t => t.name));
for (const toolName of skillTools) {
  if (!validToolNames.has(toolName)) {
    console.warn(`[buildAgent] Skill declares unknown tool "${toolName}" for agent "${agent.name}"`);
  }
}
```

This is a warning (not a throw) for backward compatibility — in case MCP tools are declared.

### 2.3 Remove 30s in-memory hash cache

**File:** `apps/server/src/agent/generate-agents-md.ts:35-38`

**Current:**
```typescript
let _cachedHash: string | null = null;
let _cachedHashAt = 0;
const HASH_CACHE_TTL_MS = 30_000;
```

Used in `maybeRefreshAgentsMd()` (line 177) to skip DB check if hash was computed <30s ago.

**Change:** Remove `_cachedHash`, `_cachedHashAt`, `HASH_CACHE_TTL_MS`, and `_resetHashCache()`. The function already does a lightweight SHA-256 compare against DB — the cache saves one DB read but adds stale-state risk with concurrent agents. The DB read is a single-row SELECT by hash, which is fast.

### 2.4 Add AGENTS.md version indicator to system prompt

**File:** `apps/server/src/agent/prompts/system.ts`

**Change:** When injecting AGENTS.md content, include a short hash prefix:
```typescript
const hash = row.input_hash?.slice(0, 8) ?? "unknown";
// In system prompt template:
`## Your Knowledge (v${hash})\n${content}`
```

This helps the agent understand when its context has changed between conversations.

---

## P2 — Frontend Quick Wins

### 2.5 Extract `SERVER_URL` constant

**Current:** Duplicated in:
- `apps/web/src/app/hooks/useEdda.ts:6`
- `apps/web/src/app/hooks/useEddaThreads.ts:6`

**Change:** Create `apps/web/src/lib/config.ts`:
```typescript
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";
```

Import from both hooks. Also check `apps/web/src/app/api/v1/items/search/route.ts:5` which has the same pattern with `SERVER_URL` (but reads `process.env.SERVER_URL` without `NEXT_PUBLIC_` prefix — server-side only, keep separate or add both).

### 2.6 Extract `useAsyncAction` hook

**Pattern repeated in 6+ components:**
```typescript
const [isPending, startTransition] = useTransition();
startTransition(async () => {
  try {
    await someAction();
    toast.success("...");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed");
  }
});
```

**New file:** `apps/web/src/app/hooks/useAsyncAction.ts`
```typescript
export function useAsyncAction(
  action: () => Promise<void>,
  options?: { onSuccess?: string; onError?: string }
): { isPending: boolean; run: () => void }
```

**Components to update:**
- `apps/web/src/app/settings/settings-client.tsx`
- `apps/web/src/app/inbox/inbox-client.tsx`
- `apps/web/src/app/agents/[name]/agent-detail-client.tsx`
- `apps/web/src/app/agents/agents-client.tsx`
- `apps/web/src/app/dashboard/dashboard-client.tsx`
- `apps/web/src/app/agents/new/new-agent-client.tsx`

---

## P3 — Polish & Maintenance

### 3.1 Split large files (optional, only if touching them)

| File | Lines | Split strategy |
|------|-------|---------------|
| `packages/db/src/items.ts` | 377 | Extract `createItem`, `batchCreateItems`, `updateItem`, `deleteItem` to `items-mutations.ts`; keep reads/search in `items.ts` |
| `packages/db/src/types.ts` | 340 | Split to `agent-types.ts`, `item-types.ts`, `entity-types.ts`, `settings-types.ts` with barrel re-export |
| `apps/server/src/cron/standalone.ts` | 310 | Extract `executeAgent()` and hook helpers to `cron-executor.ts` |

### 3.2 Track open TODOs

Create GitHub issues for:
1. `apps/server/src/cron/platform.ts:9` — "Sync crons to LangGraph Platform via its cron API"
2. `apps/server/src/cron/platform.ts:14` — Platform cleanup
3. `packages/cli/src/commands/init.ts:79` — "Read all values from process.env and skip prompts" (non-interactive mode)

### 3.3 Check for removable dependency

After removing `resizable.tsx`, check if `react-resizable-panels` can be removed from `apps/web/package.json`.

---

## Verification

After all changes:

1. **Type check:** `pnpm type-check` — ensures no broken imports from removed exports
2. **Tests:** `pnpm test` — ensures test mocks updated correctly
3. **Lint:** `pnpm lint` — catches any remaining issues
4. **Build:** `pnpm build` — full build passes
5. **Migration:** `pnpm migrate` — new migration applies cleanly (for P2.1)
6. **Manual:** Start dev server (`pnpm dev`), trigger an agent run, verify error handling works (tool throws → agent receives error message)

## Execution Order

1. P0 (dead code) — safe, no behavior change, reduces noise
2. P1.1 (tool errors) — behavior change but improves agent reliability
3. P1.2 (type safety) — no runtime change, better DX
4. P1.3 (buildUpdateQuery) — refactor, no behavior change
5. P2.1-2.4 (LangGraph) — incremental improvements
6. P2.5-2.6 (frontend) — incremental DX improvements
7. P3 (polish) — do opportunistically
