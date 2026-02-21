---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, migration, data-integrity]
dependencies: []
---

# Problem Statement
The `get_daily_dashboard()` function defined in migration 010 references columns (`dashboard_priority`, `dashboard_section`, `completable`, `has_due_date`, `is_list`, `agent_internal`) that are only added by migration 011. PL/SQL doesn't validate column references at function creation time, so 010 applies successfully but the function will fail at call time if 011 hasn't been applied. If 011 fails during migration, the function is silently broken.

# Findings
Flagged by: **data-migration-expert** (Medium)

- `packages/db/migrations/010_functions.sql` — `get_daily_dashboard()` references columns from 011.
- `packages/db/migrations/011_add_columns.sql` — Adds the columns that 010 depends on.

# Proposed Solutions
## Option A: Swap ordering (rename 010 to 011 and vice versa, or combine into one file)
- Pros: Eliminates the dependency issue entirely, clean solution
- Cons: May require updating any migration tracking records if already deployed
- Effort: Small
- Risk: Low

## Option B: Document that 010+011 must always deploy together as an atomic pair
- Pros: No file changes needed
- Cons: Relies on human discipline, easy to forget, fragile
- Effort: Small
- Risk: Medium

# Technical Details
- Affected files:
  - `packages/db/migrations/010_functions.sql`
  - `packages/db/migrations/011_add_columns.sql`

# Acceptance Criteria
- [ ] Function dependencies are satisfied before the function is created, OR migrations are documented as an atomic pair
- [ ] Running migrations from scratch on a clean database succeeds without runtime errors in `get_daily_dashboard()`

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit d059e8a, PR #1 | |
