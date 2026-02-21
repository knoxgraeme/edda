---
status: pending
priority: p1
issue_id: "040"
tags: [code-review, performance, security]
dependencies: []
---

# SELECT * Pulls 8KB Embedding Vectors Across DB Layer

## Problem Statement
Multiple query functions use `SELECT *` on tables with `embedding vector(1024)` columns, pulling ~8KB per row unnecessarily. At 10,000 items, a single unbounded query transfers ~80MB of unused embedding data. The dashboard alone runs 5 parallel `SELECT *` queries.

## Findings
- **items.ts**: `getItemById` (line 32), `searchItems` (line 103) use `SELECT *`
- **entities.ts**: `getEntityById`, `getEntitiesByName`, `searchEntities`, `resolveEntity`, `getTopEntities`, `getEntityItems` (joins `i.*`) all use `SELECT *`
- **dashboard.ts**: All 5 subqueries (lines 13-43) use `SELECT *`
- Some functions (`getTimeline`, `getAgentKnowledge`) already correctly enumerate columns — these serve as templates
- `searchItems` returns embedding to caller, which `search-items.ts` tool immediately strips in `.map()` — wasted serialization
- Agents: Performance Oracle (2.1, 2.2), TypeScript Reviewer (6, 8, 9), Simplicity Reviewer (2, 3)

## Proposed Solutions

### Option A: Shared Column Constant (Recommended)
Extract `ITEM_COLS_NO_EMBEDDING` constant and use everywhere.
- **Pros:** Single source of truth, easy to maintain
- **Effort:** Small
- **Risk:** Low

### Option B: Per-function Column Lists
Enumerate columns per function as `getTimeline` already does.
- **Pros:** Each function controls its own projection
- **Effort:** Medium (repetitive)
- **Risk:** Low but copy-paste drift

## Recommended Action
_To be filled during triage_

## Technical Details
- **Affected files:** `packages/db/src/items.ts`, `packages/db/src/entities.ts`, `packages/db/src/dashboard.ts`
- **Components:** Database query layer

## Acceptance Criteria
- [ ] No query function returns embedding column unless explicitly needed for vector operations
- [ ] Dashboard queries use explicit column lists
- [ ] `searchItems` returns similarity score without raw embedding

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle, TypeScript Reviewer, Simplicity Reviewer |

## Resources
- PR #1 - Phase 1: Foundation, DB layer, agent tools, and review fixes
