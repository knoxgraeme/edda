---
status: pending
priority: p2
issue_id: "049"
tags: [code-review, performance, reliability]
dependencies: []
---

# embedBatch Has No Chunking — Large Batches May Exceed API Limits

## Problem Statement
`embedBatch()` passes the entire text array to the embedding provider in a single call. Most APIs have batch size limits (Voyage: 128, OpenAI: 2048). Additionally, `batchCreateItemsSchema` has no `.max()` on the items array, allowing unbounded embedding API calls and costs.

## Findings
- **embed/index.ts lines 66-70:** No chunking, passes full array
- **batch-create-items.ts:** Schema has `.min(1)` but no `.max()`
- Agent: Performance Oracle (2.6), Security Sentinel (F7)

## Proposed Solutions

### Option A: Add Chunking + Max Array Size (Recommended)
Chunk embedBatch at 96 texts. Add `.max(50)` to batch schema.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] `embedBatch` chunks at a provider-safe batch size
- [ ] `batchCreateItemsSchema` has a reasonable `.max()` limit

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle, Security Sentinel |
