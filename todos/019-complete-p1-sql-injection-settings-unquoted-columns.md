---
status: complete
priority: p1
issue_id: "019"
tags: [code-review, security, sql-injection]
dependencies: []
---

# Problem Statement
`updateSettings` in `packages/db/src/settings.ts` interpolates column names from `Object.entries(updates)` directly into the SQL SET clause without quoting or allowlist validation. An LLM that can influence the `updates` object (via the `update_settings` agent tool, which accepts `z.record(z.any())`) could inject arbitrary SQL.

# Findings
Flagged by: security-sentinel (High severity)

- `packages/db/src/settings.ts` lines 37–44 — `const sets = entries.map(([k], i) => \`${k} = $${i + 1}\`).join(", ")` — no quotes around `k`, no allowlist
- `apps/server/src/agent/tools/update-settings.ts` lines 9–11 — `z.record(z.any())` schema allows arbitrary keys
- Contrast: `packages/db/src/items.ts` line 52 uses `"${k}"` quoting AND an `ITEM_UPDATE_COLUMNS` allowlist — `updateSettings` has neither

Combined with the `z.record(z.any())` tool schema, a prompt-injected key like `id = false; DROP TABLE settings; --` would execute.

# Proposed Solutions

## Option A: Allowlist + quoted columns (recommended)
Add `SETTINGS_UPDATE_COLUMNS` allowlist identical to the pattern in `items.ts`. Filter entries before building SQL. Quote column names.

```typescript
const SETTINGS_UPDATE_COLUMNS = ['llm_provider', 'default_model', ...] as const;
const entries = Object.entries(updates).filter(([k]) => SETTINGS_UPDATE_COLUMNS.includes(k as any));
const sets = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(", ");
```

Also tighten `updateSettingsSchema` in the tool to `z.object({ ... }).strict()` with only the user-modifiable keys.

## Option B: Explicit partial settings Zod schema in tool
Replace `z.record(z.any())` with an explicit `z.object` enumerating all settable keys. The DB function keeps dynamic columns but the agent input is constrained to known-safe keys.

## Option C: One explicit query per setting
Replace the dynamic query entirely with individual `SET key = $1` statements. Verbose but immune to injection.

**Recommended: Option A** — matches existing pattern in codebase, minimal surface change.

# Technical Details
- Affected files: `packages/db/src/settings.ts`, `apps/server/src/agent/tools/update-settings.ts`
- Related: todo 001 (same pattern already fixed in items.ts, entities.ts, mcp-connections.ts — settings.ts missed)

# Acceptance Criteria
- [ ] `updateSettings` uses an allowlist of valid column names
- [ ] Column names are quoted in the SQL SET clause
- [ ] `updateSettingsSchema` constrains to a closed set of settable keys
- [ ] `pnpm type-check` passes

# Work Log
- 2026-02-20: Created from security-sentinel review of 4A+4B chat port PR

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit cde337f, PR #1 | |
