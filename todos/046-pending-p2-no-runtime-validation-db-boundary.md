---
status: pending
priority: p2
issue_id: "046"
tags: [code-review, typescript, architecture]
dependencies: []
---

# No Runtime Validation at Database Boundary — Pervasive `as Type` Casts

## Problem Statement
Every database query result is blindly cast with `as Item`, `as Entity`, `as Settings`, etc. The `pg` library returns `QueryResult<any>`. If a migration renames/adds a column and the TypeScript type drifts from the schema, these casts silently pass the compiler while producing incorrect data at runtime.

## Findings
- **items.ts:** 8 cast sites (lines 27, 59, 111, 140, 164, 193, 226, 251)
- **entities.ts:** 8 cast sites
- **settings.ts, mcp-connections.ts, agent-log.ts, dashboard.ts, threads.ts, item-types.ts:** Multiple each
- Most critical: `refreshSettings()` powers entire system config — should validate with Zod
- Agent: TypeScript Reviewer (#1)

## Proposed Solutions

### Option A: Zod Validation on Critical Paths (Recommended)
Add Zod schemas for `Settings`, `Item`, `Entity` and parse at DB boundary.
- **Effort:** Medium | **Risk:** Low

### Option B: Generic Typed Pool Queries
Use `pool.query<Item>(...)` for compile-time hints (does not add runtime safety).
- **Effort:** Small | **Risk:** Medium — false safety

## Acceptance Criteria
- [ ] At minimum, `refreshSettings()` validates with Zod
- [ ] Consider adding validation to high-traffic query functions

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by TypeScript Reviewer |
