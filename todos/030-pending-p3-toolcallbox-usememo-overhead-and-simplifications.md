---
status: complete
priority: p3
issue_id: "030"
tags: [code-review, simplicity, react]
dependencies: []
---

# Problem Statement
Several small cleanup items found by the simplicity reviewer that add overhead without benefit:

1. **`ToolCallBox.tsx`** — `useMemo` wrapping a trivial destructure (no expensive computation), `useMemo` around a switch/JSX for `statusIcon`, `useCallback` on two dep-free toggle functions, redundant empty `<>` fragment
2. **`tools/index.ts`** — 24 lines of schema re-exports (`export { createItemSchema } from "./create-item.js"` × 19) with zero non-tool-file consumers. Architecture rule only requires schemas exist in individual files.
3. **`useEddaThreads.ts`** — manual field-by-field `String(thread.id ?? "")` normalization instead of a Zod parse or direct cast to the known-safe server type
4. **`AbortError` narrowing in `useEdda.ts`** — `(err as Error).name !== "AbortError"` cast from unknown; should be `err instanceof Error && err.name !== "AbortError"`

# Findings
Flagged by: code-simplicity-reviewer, kieran-typescript-reviewer

- `apps/web/src/app/components/ToolCallBox.tsx` lines 25–58: unnecessary memoization
- `apps/server/src/agent/tools/index.ts` lines 48–71: 24 schema re-export lines, no consumers
- `apps/web/src/app/hooks/useEddaThreads.ts` lines 18–28: verbose manual normalization
- `apps/web/src/app/hooks/useEdda.ts` line 134: fragile AbortError check

# Proposed Solutions

**ToolCallBox cleanup:**
```typescript
// Replace useMemo destructure with:
const { name = "Unknown Tool", args = {}, result, status = "completed" } = toolCall;

// Replace useMemo statusIcon with plain const:
const statusIcon = (() => { switch (status) { ... } })();

// Remove useCallback from toggle functions:
const toggleExpanded = () => setIsExpanded(prev => !prev);
```

**Remove schema re-exports from index.ts:**
Delete lines 48–71. The architecture hook checks individual tool files, not the barrel.

**AbortError narrowing:**
```typescript
if (err instanceof Error && err.name !== "AbortError") {
  setMessages(prev => [...prev, { ..., content: `Error: ${err.message}` }]);
}
```

# Technical Details
- ~35 lines of net removal across 3 files
- All changes are mechanical, zero behavior change

# Acceptance Criteria
- [ ] `ToolCallBox.tsx` has no `useMemo`/`useCallback` wrapping trivial operations
- [ ] `tools/index.ts` schema re-exports removed
- [ ] `AbortError` check uses `instanceof` guard
- [ ] `pnpm type-check` passes

# Work Log
- 2026-02-20: Created from simplicity + TypeScript review of 4A+4B chat port PR
