---
status: pending
priority: p2
issue_id: "048"
tags: [code-review, performance]
dependencies: []
---

# batchCreateItems Executes N Sequential INSERT Statements

## Problem Statement
Each item in a batch generates a separate INSERT query with a database round-trip. For 20 items: 22 queries (BEGIN + 20 INSERTs + COMMIT). Each INSERT uses `RETURNING *` returning the full embedding vector, but the tool only uses `item.id`. Additionally, `createItem` is missing `embedding_model` and `pending_action` columns that `batchCreateItems` includes.

## Findings
- **items.ts lines 114-150:** Loop with individual `client.query()` per item
- **batch-create-items.ts line 46:** Only uses `item.id` from returned rows
- **createItem (line 11):** Inserts 10 columns; batchCreateItems inserts 12 — misaligned
- At 50 items: 52 round-trips, potentially 200ms+ with remote DB
- Agent: Performance Oracle (2.5), Simplicity Reviewer (#12)

## Proposed Solutions

### Option A: Multi-Row INSERT (Recommended)
Build a single `INSERT INTO items (...) VALUES (...), (...), ... RETURNING id`.
- **Effort:** Medium | **Risk:** Low

### Option B: Fix Column Alignment Only (Quick Win)
Align `createItem` to include `embedding_model` and `pending_action`, keep loop.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] `createItem` and `batchCreateItems` use the same column set
- [ ] `RETURNING` clause excludes embedding column
- [ ] Batch inserts use fewer round-trips

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle, Simplicity Reviewer |
