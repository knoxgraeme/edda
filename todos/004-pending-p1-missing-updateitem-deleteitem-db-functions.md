---
status: pending
priority: p1
issue_id: "004"
tags: [code-review, architecture, agent-native]
dependencies: []
---

# Problem Statement
The manage skill references `update_item` (for complete, snooze, edit, archive operations) and `delete_item` tools. Tool stubs exist in `tools/index.ts`. However, there are NO corresponding database functions: `updateItem()` and `deleteItem()` do not exist in `items.ts`. This blocks the entire manage skill implementation in Phase 2, making it impossible for the agent to modify or remove items.

# Findings
Flagged by: agent-native-reviewer (Critical), code-simplicity-reviewer (noted)

- `packages/db/src/items.ts` — Missing `updateItem()` and `deleteItem()` functions
- `apps/server/src/skills/manage/` — Manage skill expects these DB functions to exist
- `apps/server/src/agent/tools/index.ts` — Tool stubs for update_item and delete_item reference non-existent DB layer

# Proposed Solutions
## Option A: Add updateItem and deleteItem with whitelisted columns and soft-delete
- Implement `updateItem(id, updates)` with a column whitelist (addressing issue 001 pattern) and `deleteItem(id)` using soft-delete via a status column (e.g., `status = 'archived'` or `status = 'deleted'`).
- Pros: Follows existing patterns, safe by design, soft-delete preserves data for recovery
- Cons: Requires deciding on soft-delete semantics (status value, whether to filter in queries)
- Effort: Medium
- Risk: Low

## Option B: Add updateItem and deleteItem with hard-delete
- Same as Option A for updateItem, but deleteItem performs a hard `DELETE FROM items WHERE id = $1`.
- Pros: Simpler implementation, no need to filter deleted items in queries
- Cons: Data loss is permanent, no recovery possible, may break referential integrity
- Effort: Medium
- Risk: Medium

# Technical Details
- Affected files:
  - `packages/db/src/items.ts` (new functions needed)
  - `apps/server/src/agent/tools/index.ts` (tool stubs to wire up)
  - `apps/server/src/skills/manage/` (skill implementation depends on these)
- Note: The updateItem implementation must follow the security pattern from issue 001 (no dynamic column interpolation; use whitelisted columns or explicit parameterized queries)

# Acceptance Criteria
- [ ] `updateItem(id, updates)` function exists in `packages/db/src/items.ts` with parameterized queries (no SQL injection)
- [ ] `deleteItem(id)` function exists in `packages/db/src/items.ts` with soft-delete semantics
- [ ] Column names in updateItem are validated against a whitelist or hardcoded
- [ ] Manage skill's core operations (complete, snooze, edit, archive, delete) are unblocked
- [ ] Both functions handle non-existent IDs gracefully (return null or throw descriptive error)
