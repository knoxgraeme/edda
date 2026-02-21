---
status: complete
priority: p3
issue_id: "014"
tags: [code-review, migration]
dependencies: []
---

# Problem Statement
CREATE TABLE and CREATE INDEX statements without IF NOT EXISTS are fragile for out-of-band re-runs. While the transaction-based migration runner handles normal cases, manual re-runs or recovery scenarios can fail on already-existing objects.

# Findings
Several migration files use bare CREATE TABLE and CREATE INDEX without the IF NOT EXISTS guard clause. This is inconsistent with defensive migration practices.

- `packages/db/migrations/008_agent_log.sql` — CREATE TABLE without IF NOT EXISTS
- `packages/db/migrations/009_indexes.sql` — CREATE INDEX without IF NOT EXISTS
- `packages/db/migrations/012_thread_metadata.sql` — CREATE TABLE without IF NOT EXISTS

# Proposed Solutions
## Option A: Add IF NOT EXISTS to all CREATE TABLE and CREATE INDEX statements
- Update the three migration files to use IF NOT EXISTS on all CREATE TABLE and CREATE INDEX statements
- Effort: Small

# Technical Details
- Affected files:
  - `packages/db/migrations/008_agent_log.sql`
  - `packages/db/migrations/009_indexes.sql`
  - `packages/db/migrations/012_thread_metadata.sql`

# Acceptance Criteria
- [ ] All CREATE TABLE statements in affected migrations use IF NOT EXISTS
- [ ] All CREATE INDEX statements in affected migrations use IF NOT EXISTS

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit d059e8a, PR #1 | |
