---
status: complete
priority: p1
issue_id: "020"
tags: [code-review, security, sql-injection]
dependencies: []
---

# Problem Statement
`confirmPending` and `rejectPending` in `packages/db/src/confirmations.ts` interpolate a `table` parameter directly into SQL strings (`UPDATE ${table}`, `DELETE FROM ${table}`). Although the agent tools use `z.enum(["items", "item_types", "entities"])` as a guard, the DB functions are exported from `@edda/db` and can be called by any consumer (crons, skills, future code) without that Zod guard. An attacker who controls the table argument bypasses all constraints.

# Findings
Flagged by: security-sentinel (High severity)

- `packages/db/src/confirmations.ts` line 18: `UPDATE ${table} SET confirmed = true...`
- `packages/db/src/confirmations.ts` line 32: `DELETE FROM ${table} WHERE id = $1...`
- The `z.enum` guard exists only in the tool layer — the DB function accepts any string
- Additionally: `rejectPending` line 32 interpolates `table` before reaching the `if (table === "item_types")` branch check, making future refactors fragile

# Proposed Solutions

## Option A: Explicit query per table (recommended)
Replace dynamic interpolation with a switch/lookup that uses hard-coded table names:

```typescript
async function confirmPending(table: "items" | "entities" | "item_types", id: string) {
  if (table === "item_types") {
    await pool.query("UPDATE item_types SET confirmed = true, pending_action = NULL WHERE name = $1", [id]);
  } else if (table === "items") {
    await pool.query("UPDATE items SET confirmed = true, pending_action = NULL WHERE id = $1", [id]);
  } else {
    await pool.query("UPDATE entities SET confirmed = true, pending_action = NULL WHERE id = $1", [id]);
  }
}
```

## Option B: Validated lookup map
```typescript
const TABLE_MAP = { items: "items", entities: "entities", item_types: "item_types" } as const;
const safeName = TABLE_MAP[table]; // TypeScript error if key not in map
await pool.query(`UPDATE "${safeName}" SET ...`, [id]);
```

**Recommended: Option A** — eliminates interpolation entirely, explicit per-table queries are trivially auditable.

# Technical Details
- Affected file: `packages/db/src/confirmations.ts`
- The Zod enum guard in agent tools reduces exploitability but does not fix the underlying DB function

# Acceptance Criteria
- [ ] `confirmPending` uses no table name interpolation
- [ ] `rejectPending` uses no table name interpolation
- [ ] Both functions are type-safe without relying on caller validation

# Work Log
- 2026-02-20: Created from security-sentinel review of 4A+4B chat port PR

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit cde337f, PR #1 | |
