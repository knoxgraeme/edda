---
status: complete
priority: p1
issue_id: "063"
tags: [code-review, typescript, plan-1i]
dependencies: []
---

# agent: any Type Propagated Into New Server Code

## Problem Statement
The plan uses `agent: any` for `createServer()` and `startServer()` parameters. The `DeepAgent` type is exported from `deepagents` and provides proper `.stream()`, `.invoke()` signatures. Propagating `any` into a brand new file loses all downstream type checking on the streaming pipeline.

## Findings
- Plan lines 103, 184: `function createServer(agent: any)`, `function startServer(agent: any, ...)`
- `createDeepAgent()` returns `DeepAgent` (exported from `deepagents`)
- Existing agent factory at `agent/index.ts:20` already uses `any` — should be fixed in same PR
- Agent: TypeScript Reviewer (P1-1)

## Proposed Solutions

### Option A: Use DeepAgent type (Recommended)
```typescript
import type { DeepAgent } from "deepagents";

export function createServer(agent: DeepAgent | null) { ... }
export async function startServer(agent: DeepAgent, port: number): Promise<void> { ... }
```
Also fix `createEddaAgent()` return type from `any` to `DeepAgent`.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] `createServer` and `startServer` use `DeepAgent` type, not `any`
- [ ] `createEddaAgent()` return type updated to `DeepAgent`
- [ ] `.stream()` call is type-checked at compile time
