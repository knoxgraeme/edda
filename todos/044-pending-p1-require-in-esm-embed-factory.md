---
status: pending
priority: p1
issue_id: "044"
tags: [code-review, typescript]
dependencies: []
---

# require() Calls in Embedding Factory Bypass ESM and Lose Type Safety

## Problem Statement
The embedding provider factory uses `require()` for dynamic imports in an ESM project (`"type": "module"`). This bypasses tree-shaking, returns `any`, and is inconsistent with the rest of the codebase which uses ESM throughout.

## Findings
- **File:** `apps/server/src/embed/index.ts` lines 32-44
- Three `require()` calls for Voyage, OpenAI, and Google embedding providers
- Project uses `"type": "module"` in package.json, ESM imports everywhere else
- `require()` returns `any`, losing all type information
- Agent: TypeScript Reviewer (#3)

## Proposed Solutions

### Option A: Dynamic import() (Recommended)
Replace `require()` with `await import()`. Requires making `createEmbeddings` async.
```typescript
case "voyage": {
  const { VoyageEmbeddings } = await import("@langchain/community/embeddings/voyage");
  return new VoyageEmbeddings({ modelName: model });
}
```
- **Pros:** Proper ESM, tree-shakeable, typed
- **Effort:** Small — all callers are already async
- **Risk:** Low

## Technical Details
- **Affected files:** `apps/server/src/embed/index.ts`
- `getCachedEmbeddings` becomes async, propagates to `embed()` and `embedBatch()`

## Acceptance Criteria
- [ ] No `require()` calls in the codebase
- [ ] Dynamic imports use `await import()`
- [ ] Provider classes are properly typed

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by TypeScript Reviewer |

## Resources
- PR #1
