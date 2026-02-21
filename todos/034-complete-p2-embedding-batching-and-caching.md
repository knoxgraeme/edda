---
status: complete
priority: p2
issue_id: "034"
tags: [code-review, performance, agent-tools]
dependencies: []
---

# Embedding: No Batching, No Instance Caching, Unbounded Concurrency

## Problem Statement
The `embed()` function creates a new Embeddings instance on every call and `batch_create_items` fires unbounded concurrent embedding requests via `Promise.all`. At 50+ items, this will hit rate limits and exhaust connections.

## Findings
- **Source**: performance-oracle, kieran-typescript-reviewer
- **File**: `apps/server/src/embed/index.ts:37-41` — `getEmbeddings()` creates new instance every call
- **File**: `apps/server/src/agent/tools/batch-create-items.ts:80` — `Promise.all(items.map(item => embed(item.content)))` — N concurrent HTTP requests
- Most embedding APIs accept batch input (up to 2048 items) — LangChain's `embedDocuments` already supports arrays
- Each new instance potentially creates its own HTTP client

## Proposed Solutions

### Option A: Cache instance + add embedBatch function (Recommended)
1. Cache Embeddings singleton (invalidate when provider/model changes)
2. Add `embedBatch(texts: string[]): Promise<number[][]>` using `embedDocuments` for array input
3. Use `embedBatch` in batch-create-items.ts
- Pros: Collapses N requests to 1, reuses HTTP connections
- Cons: Minor refactor of embed module
- Effort: Small
- Risk: Low

### Option B: Add concurrency limiter
Keep individual calls but add `p-limit(5)` to cap concurrent requests.
- Pros: Minimal change
- Cons: Still N requests, just throttled
- Effort: Very small
- Risk: Low

## Acceptance Criteria
- [ ] Embeddings instance cached as singleton
- [ ] `embedBatch` function exists using `embedDocuments` array API
- [ ] `batch_create_items` uses `embedBatch` instead of N individual `embed` calls
- [ ] Single-item `embed` reuses cached instance

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | |
| 2026-02-20 | Fixed in commit cde337f, PR #1 | |

## Resources
- PR commit: 960f19d
