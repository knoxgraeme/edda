---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, data-integrity, migration]
dependencies: []
---

# Problem Statement
Migration 011 adds 13 new columns to `item_types` with generic defaults (e.g., `agent_internal=false`, `completable=false`, `is_list=false`) but does NOT include UPDATE statements to set correct values for the 13 existing seed types from `004_seed_types.sql`. This means:

- Agent-internal types (preference, learned_fact, pattern) incorrectly appear on the dashboard
- task/reminder are not marked as completable
- list_item is not marked as a list type

The `get_daily_dashboard()` function added in migration 010 depends on these flags being set correctly, so the dashboard will return incorrect sections and items.

# Findings
Flagged by: data-migration-expert (HIGH - required before approval)

- `packages/db/migrations/011_add_columns.sql` — Adds columns with generic defaults but no UPDATE statements for existing seed types
- `packages/db/migrations/004_seed_types.sql` — Contains the 13 original seed types that need their new column values set
- `packages/db/migrations/010_*.sql` — Contains `get_daily_dashboard()` which depends on the flags being correct

# Proposed Solutions
## Option A: Add UPDATE statements to migration 011 or create a follow-up migration
- Add UPDATE statements to `011_add_columns.sql` (if not yet applied to production) or create a new `011b_seed_type_flags.sql` migration that sets the correct flag values for all 13 seed types.
- Pros: Simple, declarative, follows existing migration pattern
- Cons: If 011 has already been applied, must use a new migration file
- Effort: Small
- Risk: Low

## Option B: Update db:seed-settings to also set type flags
- Modify the seed script to upsert correct values for all item_type flags.
- Pros: Always idempotent, can be re-run safely
- Cons: Seeds and migrations serve different purposes; flags should be set by migration for consistency
- Effort: Small
- Risk: Medium

# Technical Details
- Affected files:
  - `packages/db/migrations/011_add_columns.sql`
  - `packages/db/migrations/004_seed_types.sql` (reference for the 13 seed types)
- The 13 seed types needing correct flag values: note, task, reminder, event, contact, preference, learned_fact, pattern, goal, project, list_item, bookmark, log
- Columns requiring correct values per type: agent_internal, completable, has_due_date, is_list, private, dashboard_priority, dashboard_section

# Acceptance Criteria
- [ ] All 13 seed item_types have correct values for agent_internal, completable, has_due_date, is_list, private, dashboard_priority, dashboard_section
- [ ] `get_daily_dashboard()` returns correct sections with agent-internal types excluded
- [ ] task and reminder types are marked as completable
- [ ] list_item type is marked as is_list
- [ ] preference, learned_fact, and pattern types are marked as agent_internal
- [ ] Migration is idempotent (safe to re-run)

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit d059e8a, PR #1 | |
