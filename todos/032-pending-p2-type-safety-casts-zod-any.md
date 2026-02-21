---
status: pending
priority: p2
issue_id: "032"
tags: [code-review, typescript, agent-tools]
dependencies: []
---

# Type Safety: Record<string, unknown> Casts and z.any() Usage

## Problem Statement
Multiple tools build update objects as `Record<string, unknown>` then cast to the proper type, bypassing TypeScript's type checking. Additionally, 5 tools use `z.record(z.any())` which leaks `any` into downstream code.

## Findings
- **Source**: kieran-typescript-reviewer
- **update-item.ts:47** — `updates as Parameters<typeof updateItem>[1]` cast. Fix: declare `const updates: Parameters<typeof updateItem>[1] = {}`
- **update-item.ts:56** — `item.status as ItemStatus` cast is unnecessary (already typed). Remove the cast and unused `ItemStatus` import.
- **reject-pending.ts:36** — `item.metadata.previous_type as string` needs a runtime type guard instead of cast
- **update-mcp-connection.ts:19** — `Record<string, unknown>` should be `Partial<Pick<McpConnection, 'enabled' | 'name'>>`
- **5 files** use `z.record(z.any())`: create-item.ts, batch-create-items.ts, update-item.ts, create-item-type.ts, update-settings.ts — replace with `z.record(z.unknown())`
- **batch-create-items.ts:42** — `source: "chat" as const` is unnecessary; create-item.ts doesn't use it (inconsistent)

## Proposed Solutions

### Option A: Fix all type issues (Recommended)
- Replace `Record<string, unknown>` with proper typed declarations
- Add type guard for metadata.previous_type
- Replace z.any() with z.unknown()
- Remove unnecessary casts
- Effort: Small
- Risk: Low

## Acceptance Criteria
- [ ] No `as` type casts except where unavoidable
- [ ] No `z.any()` in any tool schema
- [ ] update objects typed with proper DB types
- [ ] Runtime type guard on metadata.previous_type

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | |

## Resources
- PR commit: 960f19d
