---
status: complete
priority: p2
issue_id: "062"
tags: [code-review, type-safety, quality]
dependencies: []
---

# Fix Promise<any> Return Type and Unsafe Casts in Agent Factory

## Problem Statement
`createEddaAgent()` returns `Promise<any>` which silently disables type checking on all callers. Additionally, two `as` casts in the agent factory (`as Promise<BaseCheckpointSaver>` and `as StructuredTool`) paper over weak return types in the source factories rather than fixing them.

## Findings
- **Source**: kieran-typescript-reviewer, code-simplicity-reviewer
- **File**: `apps/server/src/agent/index.ts:20` — `Promise<any>` return type
- **File**: `apps/server/src/agent/index.ts:26` — `getCheckpointer() as Promise<BaseCheckpointSaver>`
- **File**: `apps/server/src/agent/index.ts:35` — `searchTool as StructuredTool`
- **File**: `apps/server/src/checkpointer/index.ts` — returns `Promise<unknown>`, should return `Promise<BaseCheckpointSaver>`
- **File**: `apps/server/src/search/index.ts` — returns `unknown | null`, should return `StructuredTool | null`
- Principle: casts should live where the type is knowable, not downstream

## Proposed Solutions

### Option A: Fix return types at source + use DeepAgent (Recommended)
1. Change `getCheckpointer()` return type to `Promise<BaseCheckpointSaver>`
2. Change `getSearchTool()` return type to `StructuredTool | null`
3. Change `createEddaAgent()` return type to `Promise<DeepAgent>` (default generics) or use `ReturnType`
4. Remove all casts from agent/index.ts
- Pros: Type-safe throughout, casts eliminated at source
- Cons: Need to add type imports to checkpointer and search modules
- Effort: Small
- Risk: None

## Acceptance Criteria
- [ ] `getCheckpointer()` returns `Promise<BaseCheckpointSaver>`
- [ ] `getSearchTool()` returns `StructuredTool | null`
- [ ] No `as` casts in agent/index.ts
- [ ] `createEddaAgent()` has a proper return type (not `any`)
- [ ] `tsc --noEmit` passes

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | TS2742 workaround caused `any` leak |
| 2026-02-20 | Fixed | Addressed in agent factory review fixes commit |
## Resources
- `apps/server/src/agent/index.ts`
- `apps/server/src/checkpointer/index.ts`
- `apps/server/src/search/index.ts`
