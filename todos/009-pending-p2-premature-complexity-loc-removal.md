---
status: pending
priority: p3
issue_id: "009"
tags: [code-review, simplicity]
dependencies: ["001"]
---

# Problem Statement
`findRecentItemsByContent` is a near-duplicate of `searchItems` with fewer options. It should be removed and callers redirected to `searchItems`.

The dynamic SET builders (mcp-connections, items, entities) are already addressed by todo 001 (SQL injection fix via column whitelisting), which inherently simplifies them.

`batchCreateItems` sequential loop and broad `config.ts` schema are acceptable given full build-out scope.

# Findings
Flagged by: **code-simplicity-reviewer**, **kieran-typescript-reviewer** (Medium)

- `packages/db/src/items.ts` — `findRecentItemsByContent` (lines 165-180) duplicates `searchItems` without type filter or configurable limit.

# Proposed Solutions
## Option A: Remove findRecentItemsByContent
- Delete the function and redirect any callers to `searchItems(embedding, { threshold })`.
- Effort: Small
- Risk: Low

# Technical Details
- Affected files:
  - `packages/db/src/items.ts` (remove `findRecentItemsByContent`)

# Acceptance Criteria
- [ ] `findRecentItemsByContent` removed from items.ts
- [ ] No callers reference the removed function
- [ ] `searchItems` used in its place where needed
