---
status: complete
priority: p2
issue_id: "033"
tags: [code-review, performance, correctness, agent-tools]
dependencies: []
---

# search_items `after` Date Filter Applied in JS, Not SQL

## Problem Statement
The `search_items` tool accepts an `after` date parameter but filters results in JavaScript after the DB query returns. This causes two bugs:
1. **Incorrect result counts**: DB returns `limit` results, JS filters some out → fewer results returned than expected, even though more matching rows exist.
2. **Wasted DB work**: Database performs vector scan + similarity computation on rows that will be discarded.

## Findings
- **Source**: kieran-typescript-reviewer, security-sentinel, performance-oracle, code-simplicity-reviewer (all 4 flagged this)
- **File**: `apps/server/src/agent/tools/search-items.ts:49-51` — `results.filter((r) => r.day >= after)`
- **File**: `packages/db/src/items.ts:71-106` — `searchItems` has no `day` parameter
- The `items` table already has an index on `day` (`idx_items_day`) so adding a SQL filter is free

## Proposed Solutions

### Option A: Push filter to SQL (Recommended)
Add `after?: string` option to `searchItems` DB function. Add `day >= $N::date` condition.
- Pros: Correct results, efficient, uses existing index
- Cons: Modifies DB function signature
- Effort: Small
- Risk: Low

## Acceptance Criteria
- [ ] `searchItems` accepts `after` parameter
- [ ] Date filter applied in SQL WHERE clause
- [ ] JS filter removed from search-items.ts
- [ ] Results count matches `limit` when sufficient rows exist

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | All 4 review agents flagged this independently |
| 2026-02-20 | Fixed in commit cde337f, PR #1 | |

## Resources
- PR commit: 960f19d
