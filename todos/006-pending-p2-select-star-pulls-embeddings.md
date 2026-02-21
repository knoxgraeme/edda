---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, performance]
dependencies: []
---

# Problem Statement
Using `SELECT *` on the items table pulls the embedding column (~4KB per row of float32 vector data). For queries that don't need embeddings (dashboard, timeline, lists), this wastes bandwidth and memory. At 1000 rows, that's ~4MB of unnecessary data transferred per query.

# Findings
Flagged by: **performance-oracle**, **code-simplicity-reviewer**

- `packages/db/src/items.ts` — `getListItems()` uses `SELECT *`, pulling embeddings unnecessarily.
- `packages/db/src/items.ts` — `getTimeline()` uses `SELECT *`, pulling embeddings unnecessarily.
- `packages/db/src/items.ts` — `getAgentKnowledge()` uses `SELECT *`, pulling embeddings unnecessarily.
- `packages/db/src/items.ts` — `findRecentItemsByContent()` uses `SELECT *`, pulling embeddings unnecessarily.

# Proposed Solutions
## Option A: Replace SELECT * with explicit column lists excluding embedding
- Pros: Simple change, immediate performance improvement, no API changes needed
- Cons: Column lists need to be maintained when schema changes
- Effort: Small
- Risk: Low

# Technical Details
- Affected files:
  - `packages/db/src/items.ts` (`getListItems`, `getTimeline`, `getAgentKnowledge`, `findRecentItemsByContent`)
- Only `searchItems()` (which needs embeddings for similarity ranking) should select the embedding column.

# Acceptance Criteria
- [ ] No `SELECT *` on the items table
- [ ] Only `searchItems()` (which needs embeddings for similarity) selects the embedding column
- [ ] All affected query functions use explicit column lists
