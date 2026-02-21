---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, quality]
dependencies: []
---

# Problem Statement
`confirmItemType(id)` and `deleteItemType(id)` accept a parameter named `id` but the WHERE clause uses `name = $1`. This is semantically confusing and may cause bugs if callers pass an actual UUID id instead of a type name string. Additionally, `deleteItemType` has no guard against deleting built-in types, which could break core functionality.

# Findings
Flagged by: **kieran-typescript-reviewer** (High)

- `packages/db/src/item-types.ts` — `confirmItemType(id)` parameter named `id` but WHERE clause filters by `name = $1`.
- `packages/db/src/item-types.ts` — `deleteItemType(id)` parameter named `id` but WHERE clause filters by `name = $1`.
- `packages/db/src/item-types.ts` — `deleteItemType` has no guard preventing deletion of built-in types.

# Proposed Solutions
## Option A: Rename parameter to `name: string` and add built-in type guard
- Pros: Eliminates confusion, prevents accidental deletion of built-in types, simple change
- Cons: Breaking change for any existing callers (parameter rename)
- Effort: Small
- Risk: Low

# Technical Details
- Affected files:
  - `packages/db/src/item-types.ts` (`confirmItemType`, `deleteItemType`)

# Acceptance Criteria
- [ ] Parameter names match their SQL usage (renamed from `id` to `name`)
- [ ] Built-in types cannot be deleted via `deleteItemType`
- [ ] All callers of these functions are updated to use the new parameter name
