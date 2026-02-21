---
status: pending
priority: p2
issue_id: "047"
tags: [code-review, performance]
dependencies: ["040"]
---

# Dashboard Runs 5 Unbounded Queries, Ignores Stored Function

## Problem Statement
`getDashboard` executes 5 parallel `SELECT *` queries without LIMIT clauses. A stored function `get_daily_dashboard(p_date)` in migration 011 does proper column selection and joins, but the TypeScript implementation doesn't use it. Additionally, dashboard uses raw `(metadata->>'due_date')::date` cast instead of the `safe_date()` function, causing both index misuse and crash risk on malformed dates.

## Findings
- **dashboard.ts:** All 5 queries lack LIMIT, use SELECT * (lines 13-43)
- **011_functions.sql:** `get_daily_dashboard()` exists with proper implementation
- **dashboard.ts line 17:** Raw `::date` cast vs `safe_date()` expression index
- `openItems` query grows monotonically as items accumulate
- Agent: Performance Oracle (2.2, 3.4)

## Proposed Solutions

### Option A: Call Stored Function (Recommended)
Replace the 5 parallel queries with a single `SELECT * FROM get_daily_dashboard($1)` call.
- **Effort:** Small | **Risk:** Low

### Option B: Fix Inline Queries
Add LIMIT clauses, explicit columns, use `safe_date()`.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] Dashboard queries have LIMIT clauses
- [ ] Uses `safe_date()` instead of raw `::date` cast
- [ ] No embedding columns returned

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle |
