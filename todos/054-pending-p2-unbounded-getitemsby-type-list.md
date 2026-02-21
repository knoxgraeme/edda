---
status: pending
priority: p2
issue_id: "054"
tags: [code-review, performance]
dependencies: []
---

# getItemsByType and getListItems Have No LIMIT Clause

## Problem Statement
Both functions return unbounded result sets. `getItemsByType('note')` with 10,000 notes returns all rows. `getListItems` can grow arbitrarily large. While column selection is correct (no embedding), unbounded result sets are a memory and network concern.

## Findings
- **items.ts lines 234-252:** `getItemsByType` — no LIMIT, returns all items of type
- **items.ts lines 152-165:** `getListItems` — no LIMIT
- Agent: Performance Oracle (2.3, 2.4)

## Proposed Solutions

### Option A: Add limit Parameter with Defaults (Recommended)
Add `limit` parameter: `getItemsByType(type, status, limit = 100)`, `getListItems(name, limit = 200)`.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] Both functions accept a `limit` parameter with reasonable defaults
- [ ] Tools that call these pass appropriate limits

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle |
