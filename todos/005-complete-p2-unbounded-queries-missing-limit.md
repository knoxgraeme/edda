---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, performance]
dependencies: []
---

# Problem Statement
Multiple query functions have no LIMIT clause. As data grows, these become performance bottlenecks and memory risks. `getAgentKnowledge()` and `getTimeline()` could return thousands of rows, and `getUnprocessedThreads()` has no cap, meaning a single call could load an unbounded result set into memory.

# Findings
Flagged by: **performance-oracle**, **kieran-typescript-reviewer** (High)

- `packages/db/src/items.ts` — `getAgentKnowledge()` returns all matching rows with no LIMIT.
- `packages/db/src/items.ts` — `getTimeline()` returns all matching rows with no LIMIT.
- `packages/db/src/threads.ts` — `getUnprocessedThreads()` has no cap on returned rows.

# Proposed Solutions
## Option A: Add sensible LIMIT defaults with optional override
- Pros: Simple to implement, backwards-compatible if default is generous (e.g., 100)
- Cons: Callers that truly need all rows must explicitly pass a higher limit
- Effort: Small
- Risk: Low

## Option B: Add cursor-based pagination
- Pros: Scalable long-term, handles arbitrarily large datasets
- Cons: More invasive API change, callers need to handle pagination logic
- Effort: Medium
- Risk: Low

# Technical Details
- Affected files:
  - `packages/db/src/items.ts` (`getAgentKnowledge`, `getTimeline`)
  - `packages/db/src/threads.ts` (`getUnprocessedThreads`)

# Acceptance Criteria
- [ ] All query functions that return lists have a LIMIT clause (hardcoded or parameterized)
- [ ] Default LIMIT values are documented in code comments
- [ ] Existing callers are verified to work correctly with the new defaults

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit d059e8a, PR #1 | |
