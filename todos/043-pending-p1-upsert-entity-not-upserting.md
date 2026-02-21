---
status: pending
priority: p1
issue_id: "043"
tags: [code-review, typescript, correctness]
dependencies: []
---

# upsertEntity Does Not Actually Upsert — Plain INSERT Only

## Problem Statement
The `upsertEntity` function in `entities.ts` is named "upsert" but performs only an INSERT with no `ON CONFLICT` clause. When the agent calls `upsert_entity` twice for the same entity name, it will either throw a constraint error or create a duplicate. This is a functional correctness bug.

## Findings
- **File:** `packages/db/src/entities.ts` lines 8-29
- SQL is plain `INSERT INTO entities (...) VALUES (...) RETURNING *` — no `ON CONFLICT`
- Tool `upsert-entity.ts` depends on this being a true upsert
- Agent will reasonably call this multiple times for the same entity
- Agent: TypeScript Reviewer (#7)

## Proposed Solutions

### Option A: Add ON CONFLICT DO UPDATE (Recommended)
```sql
INSERT INTO entities (name, type, aliases, description, embedding)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (name) DO UPDATE SET
  type = COALESCE(EXCLUDED.type, entities.type),
  aliases = EXCLUDED.aliases,
  description = COALESCE(EXCLUDED.description, entities.description),
  embedding = EXCLUDED.embedding,
  updated_at = NOW()
RETURNING *
```
- **Pros:** True upsert, idempotent, expected behavior
- **Effort:** Small
- **Risk:** Low — requires unique constraint on `name`

### Option B: Check-then-insert Pattern
Query first, then INSERT or UPDATE.
- **Pros:** More control over merge logic
- **Effort:** Medium
- **Risk:** Race condition without transaction

## Technical Details
- **Affected files:** `packages/db/src/entities.ts`
- Verify unique constraint exists on `entities.name`

## Acceptance Criteria
- [ ] Calling `upsertEntity` twice with same name updates existing entity
- [ ] No duplicate entities created
- [ ] Embedding and metadata are merged on conflict

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by TypeScript Reviewer |

## Resources
- PR #1
