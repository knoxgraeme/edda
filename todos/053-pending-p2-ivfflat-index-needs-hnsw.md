---
status: pending
priority: p2
issue_id: "053"
tags: [code-review, performance]
dependencies: []
---

# IVFFlat Vector Index Ineffective on Fresh Install — Should Use HNSW

## Problem Statement
IVFFlat indexes with `lists = 100` need ~10,000+ rows to build effectively. On a fresh install with <100 rows, searches miss relevant results. Items and entities tables both use IVFFlat.

## Findings
- **005_items.sql line 28:** `CREATE INDEX ... USING ivfflat ... WITH (lists = 100)`
- **006_entities.sql line 20:** Same with `lists = 50`
- IVFFlat requires pre-populated table; HNSW does not
- Agent: Performance Oracle (3.1)

## Proposed Solutions

### Option A: Switch to HNSW (Recommended)
New migration to drop IVFFlat indexes and create HNSW indexes.
```sql
CREATE INDEX idx_items_embedding ON items USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```
- **Effort:** Small (new migration) | **Risk:** Low

## Acceptance Criteria
- [ ] Vector indexes use HNSW instead of IVFFlat
- [ ] Semantic search works correctly on small datasets

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle |
