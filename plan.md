# Plan: Subagent Mode Implementation

## Summary

Add a "subagent mode" to Edda so that when an agent is spawned via deepagents' built-in `task` tool (synchronous subagent), it automatically gets stripped-down overrides — no nesting, no memory writes, no self-improvement. This keeps subagents as focused workers while the `run_agent` tool continues to spawn full standalone agents. The overrides are configurable globally via a new `settings` column, with per-agent escape hatches via `agent.metadata.subagent_overrides`.

## Key Insight: Where to Apply Overrides

deepagents' `task` tool invokes subagents using the `SubagentSpec` passed to `createDeepAgent()`. This means the overrides must be applied **at build time** in `resolveSubagents()` — the spec we pass to deepagents IS the subagent's identity. There's no runtime hook.

This is actually clean: `resolveSubagents()` is the single place where subagent specs are constructed, and it already has access to the agent's DB row, skills, and settings.

## Changes

### 1. Database: Add `subagent_overrides` to settings table

**File:** `packages/db/migrations/010_subagent_mode.sql` (new)

```sql
ALTER TABLE settings
  ADD COLUMN subagent_overrides JSONB NOT NULL DEFAULT '{
    "blocked_tools": ["run_agent", "save_agents_md", "seed_agents_md", "create_agent", "delete_agent", "update_agent", "install_skill"],
    "blocked_skills": ["self_improvement", "self_reflect", "admin"],
    "memory_capture": false,
    "allow_nesting": false
  }';
```

This is a single JSONB column with the global policy. Sensible defaults ship out of the box. Admin can tune via `update_settings`.

### 2. Types: Add `subagent_overrides` to Settings type and define SubagentOverrides

**File:** `packages/db/src/types.ts`

Add to `Settings` interface:
```typescript
subagent_overrides: SubagentOverrides;
```

Add new type:
```typescript
export interface SubagentOverrides {
  blocked_tools: string[];
  blocked_skills: string[];
  memory_capture: boolean;
  allow_nesting: boolean;
}
```

### 3. Settings: Allow updating `subagent_overrides`

**File:** `packages/db/src/settings.ts`

Add `"subagent_overrides"` to `SETTINGS_UPDATE_COLUMNS`.

### 4. Core logic: Apply overrides in `resolveSubagents()`

**File:** `apps/server/src/agent/build-agent.ts`

Modify `resolveSubagents()` to apply the global + per-agent overrides when constructing each `SubagentSpec`. The changes are isolated to this one function.

**Before (current, lines 196-215):**
Each subagent gets its full DB config: all skills, all tools, memory flags, and its own subagents.

**After:**
```typescript
async function resolveSubagents(
  names: string[],
  available: StructuredTool[],
  store: BaseStore,
  settings: Settings,
): Promise<SubagentSpec[]> {
  if (names.length === 0) return [];

  const rows = await getAgentsByNames(names);
  const enabled = rows.filter((r) => r.enabled);

  // Global overrides from settings
  const globalOverrides = settings.subagent_overrides;

  // ... existing batch skill fetch ...

  const specs = await Promise.all(
    enabled.map(async (row) => {
      // --- Apply subagent mode overrides ---
      const agentOverrides = (row.metadata?.subagent_overrides ?? {}) as Partial<SubagentOverrides>;
      const effective = mergeOverrides(globalOverrides, agentOverrides);

      // Strip blocked skills
      const effectiveSkills = row.skills.filter(
        (s) => !effective.blocked_skills.includes(s)
      );

      // Strip subagents if nesting disallowed
      // (no-op for SubagentSpec since we just don't recurse,
      //  but also strip the `task` tool availability)

      // Build prompt with memory_capture override
      const overriddenRow: Agent = {
        ...row,
        skills: effectiveSkills,
        memory_capture: effective.memory_capture,
        subagents: effective.allow_nesting ? row.subagents : [],
      };
      const systemPrompt = await buildPrompt(overriddenRow, settings);

      // Scope tools with blocked tools removed
      const declared = collectFromSkills(getRowSkills(overriddenRow), "allowed-tools");
      for (const t of overriddenRow.tools) declared.add(t);
      declared.add("list_my_runs");
      // Remove blocked tools
      for (const bt of effective.blocked_tools) declared.delete(bt);
      const scoped = scopeTools(available, declared);

      // ... existing schema normalization ...

      return {
        name: row.name,
        description: row.description,
        systemPrompt,
        tools: subTools,
        skills: effectiveSkills.length > 0 ? ["/skills/"] : [],
        model,
      } satisfies SubagentSpec;
    }),
  );

  return specs;
}
```

**New helper function** (same file):
```typescript
function mergeOverrides(
  global: SubagentOverrides,
  perAgent: Partial<SubagentOverrides>,
): SubagentOverrides {
  return {
    blocked_tools: perAgent.blocked_tools ?? global.blocked_tools,
    blocked_skills: perAgent.blocked_skills ?? global.blocked_skills,
    memory_capture: perAgent.memory_capture ?? global.memory_capture,
    allow_nesting: perAgent.allow_nesting ?? global.allow_nesting,
  };
}
```

### 5. Prompt adjustment: Strip delegation guidance for subagents

**File:** `apps/server/src/agent/build-agent.ts`

When building the prompt for a subagent (detected by empty `subagents` array after override), the delegation line is already automatically skipped because the condition `hasSubagents = agent.subagents.length > 0` will be false. No additional change needed — the existing logic handles this.

### 6. Skill writing: Only write non-blocked skills to store

**File:** `apps/server/src/agent/build-agent.ts`

In the `resolveSubagents()` function, the `writeSkillsToStore()` call already uses `getRowSkills(row)`. After the override, we pass `getRowSkills(overriddenRow)` which only contains the non-blocked skills. This is already handled by the override in step 4.

### 7. Settings UI: Expose `subagent_overrides` in settings page

**File:** `apps/web/src/app/settings/` (settings page)

Add a section in the settings UI for "Subagent Mode" that allows editing the JSONB as a structured form:
- Blocked tools (multi-select from available tools)
- Blocked skills (multi-select from available skills)
- Memory capture (toggle)
- Allow nesting (toggle)

This is a nice-to-have and can be deferred. The setting is editable via the `update_settings` tool immediately.

### 8. Agent detail UI: Per-agent override escape hatch

**File:** `apps/web/src/app/agents/[name]/agent-detail-client.tsx`

No changes needed initially. Per-agent overrides live in `metadata.subagent_overrides` and are already editable via the existing metadata JSON editor. A structured UI can be added later.

## Files Changed (Summary)

| File | Change | Type |
|------|--------|------|
| `packages/db/migrations/010_subagent_mode.sql` | New migration: add `subagent_overrides` column | New file |
| `packages/db/src/types.ts` | Add `SubagentOverrides` type, add to `Settings` | Edit |
| `packages/db/src/settings.ts` | Add `subagent_overrides` to update allowlist | Edit |
| `apps/server/src/agent/build-agent.ts` | Add `mergeOverrides()`, modify `resolveSubagents()` | Edit |

## Files NOT Changed (and why)

| File | Reason |
|------|--------|
| `run-agent.ts` | `run_agent` spawns **standalone** agents — no overrides apply |
| `backends.ts` | Store mounts are per-agent, not affected by subagent mode |
| `agent-cache.ts` | Subagents are resolved at parent build time, not cached separately |
| `run-execution.ts` | Execution lifecycle is the same regardless of mode |
| `tools/index.ts` | Tool pool is unchanged; scoping happens in `resolveSubagents()` |

## How It Works End-to-End

1. **Admin sets policy** once (or uses defaults): `settings.subagent_overrides = { blocked_tools: [...], ... }`
2. **Agent is built** via `buildAgent(agentRow)` — if it has subagents, calls `resolveSubagents()`
3. **For each subagent**, `resolveSubagents()`:
   - Reads global overrides from `settings.subagent_overrides`
   - Reads per-agent overrides from `row.metadata.subagent_overrides` (if any)
   - Merges (per-agent wins)
   - Strips blocked tools, blocked skills, disables memory_capture, empties subagents
   - Builds a clean `SubagentSpec` with the stripped-down config
4. **deepagents receives** the SubagentSpec and uses it for the built-in `task` tool
5. **When `task` is called**, the subagent runs with its restricted config — no `run_agent`, no `save_agents_md`, no nesting
6. **When `run_agent` is called**, the target agent is built fresh via `buildAgent()` with its FULL config — no overrides

## Validation

- `pnpm type-check` — Ensure types are correct across packages
- `pnpm lint` — Formatting/linting
- `pnpm build` — Full build
- `pnpm test` — Run test suite
- Manual: verify that a parent agent with subagents builds correctly, and that the subagent's tool list excludes blocked tools
