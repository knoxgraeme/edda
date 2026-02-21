---
status: pending
priority: p2
issue_id: "050"
tags: [code-review, correctness, simplicity]
dependencies: []
---

# reject-pending Only Handles Items; Duplicate confirm/reject Functions Across Modules

## Problem Statement
The `reject_pending` tool only supports the `items` table despite accepting `entities` and `item_types` in its schema. Meanwhile, unified `confirmPending`/`rejectPending` functions exist in `confirmations.ts` but aren't used. Old per-table functions (`rejectItemConfirmation`, `rejectEntityConfirmation`, `confirmItemType`) remain as dead code.

## Findings
- **reject-pending.ts lines 15-17:** Returns error for non-items tables
- **confirmations.ts:** Has unified `confirmPending`/`rejectPending` supporting all tables
- **items.ts:229:** `rejectItemConfirmation` — superseded by confirmations.ts
- **entities.ts:144:** `rejectEntityConfirmation` — superseded
- **item-types.ts:51:** `confirmItemType` — superseded
- Agent: TypeScript Reviewer (#10), Simplicity Reviewer (#1, #5)

## Proposed Solutions

### Option A: Use Unified Functions, Delete Duplicates (Recommended)
Update `reject-pending.ts` to use `rejectPending` from confirmations.ts for all tables. Delete per-module functions.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] `reject_pending` works for items, entities, and item_types
- [ ] Old per-table confirm/reject functions removed
- [ ] Item reclassification revert logic preserved for items table

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by TypeScript Reviewer, Simplicity Reviewer |
