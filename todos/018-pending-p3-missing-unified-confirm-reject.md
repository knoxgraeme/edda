---
status: pending
priority: p3
issue_id: "018"
tags: [code-review, agent-native]
dependencies: []
---

# Problem Statement
The manage skill describes confirm_pending and reject_pending as single tools that work across items, entities, and item_types. However, the current DB layer has separate type-specific functions and is missing confirmItem(). There is no unified interface for the agent to confirm or reject pending records across all three tables.

# Findings
The manage skill's SKILL.md documents a unified confirm/reject interface, but the database layer implements separate functions per table type. Additionally, confirmItem() is missing entirely. This forces the agent tool layer to handle dispatch logic that belongs in the DB package.

- `packages/db/src/items.ts` — missing confirmItem(), has separate item-specific functions
- `packages/db/src/entities.ts` — has entity-specific confirm/reject functions
- `packages/db/src/item-types.ts` — has item-type-specific confirm/reject functions

# Proposed Solutions
## Option A: Add unified dispatch functions
- Create confirmPending(table, id) and rejectPending(table, id) functions that dispatch to the correct table-specific implementation
- Add the missing confirmItem() function to items.ts
- Export unified functions from the db package
- Effort: Small

# Technical Details
- Affected files:
  - `packages/db/src/items.ts` (add confirmItem)
  - `packages/db/src/entities.ts`
  - `packages/db/src/item-types.ts`
  - `packages/db/src/index.ts` (export unified functions)

# Acceptance Criteria
- [ ] Single confirmPending function dispatches across items, entities, and item_types tables
- [ ] Single rejectPending function dispatches across items, entities, and item_types tables
- [ ] confirmItem() exists in items.ts
