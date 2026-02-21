---
status: complete
priority: p2
issue_id: "025"
tags: [code-review, typescript, type-safety]
dependencies: []
---

# Problem Statement
Several TypeScript type safety issues across the new files that let runtime errors slip past the compiler:

1. **`SDKToolCall` is a flat interface with all-optional fields** — should be a discriminated union per wire format, eliminating the `toolCall.function?.name || toolCall.name || toolCall.type || "unknown"` fallback chains
2. **`update-item.ts` unsafe cast** — builds `Record<string, unknown>` then casts with `as Parameters<typeof updateItem>[1]`, bypassing the type checker for a DB write
3. **`update-settings.ts` `z.record(z.any())`** — critical settings table accepts arbitrary keys/values; should be an explicit partial schema
4. **`useEddaThreads.ts` manual cast** — `t as Record<string, unknown>` with field-by-field `String()` coercion instead of Zod parse
5. **`reject-pending.ts` unguarded metadata access** — `item.metadata?.previous_type` in guard but `item.metadata.previous_type` (no optional chain) in the body
6. **`MarkdownContent.tsx` `inline` prop** — deprecated/removed in react-markdown v9+, always `undefined`, causing all code blocks to render as inline `<code>` instead of `SyntaxHighlighter`

# Findings
Flagged by: kieran-typescript-reviewer

- `apps/web/src/app/types/types.ts` lines 23–33: `SDKToolCall` all-optional fields
- `apps/server/src/agent/tools/update-item.ts` lines 45–48: `updates as Parameters<...>`
- `apps/server/src/agent/tools/update-settings.ts` lines 9–11: `z.record(z.any())`
- `apps/web/src/app/hooks/useEddaThreads.ts` lines 19–28: manual cast
- `apps/server/src/agent/tools/reject-pending.ts` lines 31–37: unguarded property access
- `apps/web/src/app/components/MarkdownContent.tsx` lines 27–36: `inline` prop

# Proposed Solutions

## SDKToolCall → discriminated union (or simplify to LangChain format only)
Since LangGraph normalizes all providers to the LangChain format, the OpenAI and Anthropic branches in `ChatInterface.tsx` are YAGNI. Remove them and collapse `SDKToolCall` to `{ id: string; name: string; args: Record<string, unknown> }`.

## update-item.ts — concrete type
```typescript
import type { ItemUpdate } from "@edda/db";
const updates: Partial<ItemUpdate> = {};
if (status !== undefined) updates.status = status;
// etc.
const item = await updateItem(item_id, updates);
```

## react-markdown v9 inline code detection
Check installed version. If v9+, replace `inline` prop check with parent element check or use the `node` API.

## reject-pending.ts safe narrowing
```typescript
const previousType = item.metadata?.previous_type;
if (item.pending_action?.startsWith("Reclassified") && typeof previousType === "string") {
  await updateItem(id, { type: previousType, confirmed: true, pending_action: null });
}
```

# Technical Details
Files: `apps/web/src/app/types/types.ts`, `apps/server/src/agent/tools/update-item.ts`, `apps/server/src/agent/tools/update-settings.ts`, `apps/web/src/app/hooks/useEddaThreads.ts`, `apps/server/src/agent/tools/reject-pending.ts`, `apps/web/src/app/components/MarkdownContent.tsx`

# Acceptance Criteria
- [ ] `SDKToolCall` or its equivalent is properly typed
- [ ] `update-item.ts` uses a concrete type for updates object
- [ ] `reject-pending.ts` metadata access is fully guarded
- [ ] `MarkdownContent.tsx` syntax highlighting works for fenced code blocks
- [ ] `pnpm type-check` passes with zero `any` casts in new files

# Work Log
- 2026-02-20: Created from kieran-typescript-reviewer of 4A+4B chat port PR
