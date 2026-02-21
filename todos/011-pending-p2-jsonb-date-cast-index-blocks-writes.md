---
status: pending
priority: p2
issue_id: "011"
tags: [code-review, migration, data-integrity]
dependencies: []
---

# Problem Statement
The expression index `((metadata->>'due_date')::date)` will throw a runtime error on INSERT/UPDATE if any confirmed item has a `metadata.due_date` value that isn't a valid ISO date string (e.g., "soon", "TBD", "next week"). This blocks ALL writes to the items table for confirmed items with due_date, making it a potential production-breaking issue.

# Findings
Flagged by: **data-migration-expert** (Medium)

- `packages/db/migrations/009_indexes.sql` (lines 12-14) — Expression index uses `((metadata->>'due_date')::date)` with no error handling for invalid date strings.

# Proposed Solutions
## Option A: Create a safe_date() wrapper function that returns NULL on parse failure
- Pros: Database-level protection, transparent to application code, index remains useful
- Cons: Silently swallows bad dates (but NULL is safe for indexing)
- Effort: Small
- Risk: Low

## Option B: Add application-level Zod validation on due_date before INSERT
- Pros: Catches bad data early, better error messages to users/agents
- Cons: Doesn't protect against direct SQL inserts or other entry points, defense-in-depth still needs DB-level safety
- Effort: Small
- Risk: Medium (incomplete coverage without DB-level fix)

# Technical Details
- Affected files:
  - `packages/db/migrations/009_indexes.sql` (lines 12-14)
- The index is a partial expression index on confirmed items. Any non-ISO-date string in `metadata.due_date` will cause a `::date` cast failure, which PostgreSQL propagates as an error on the INSERT/UPDATE operation.

# Acceptance Criteria
- [ ] Invalid date strings in `metadata.due_date` cannot block table writes
- [ ] The index still functions correctly for valid date values
- [ ] Existing data with invalid dates (if any) does not break after the fix is applied
