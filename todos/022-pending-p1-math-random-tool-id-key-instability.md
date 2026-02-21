---
status: complete
priority: p1
issue_id: "022"
tags: [code-review, react, correctness]
dependencies: []
---

# Problem Statement
`ChatInterface.tsx` uses `Math.random()` as a fallback tool call ID. Because `processedMessages` is a `useMemo` that recomputes on every `messages` state update (i.e., every SSE chunk), tool calls without a server-assigned `id` get a new random ID on every render. React uses these IDs as `key` props for `ToolCallBox`, causing every such tool call to unmount and remount on every token — destroying `isExpanded` state and causing unnecessary DOM churn.

Additionally, `showAvatar` is computed in `processedMessages` and attached to each processed message, but `ChatMessage` has no `showAvatar` prop — the computation is dead code that runs on every render.

# Findings
Flagged by: kieran-typescript-reviewer (Critical), performance-oracle (P1), security-sentinel (Low), code-simplicity-reviewer

- `apps/web/src/app/components/ChatInterface.tsx` line 89: `id: toolCall.id || \`tool-${Math.random()}\``
- `apps/web/src/app/components/ChatInterface.tsx` lines 126–131: `showAvatar` computed but never passed to `ChatMessage`
- `apps/web/src/app/components/ChatMessage.tsx`: no `showAvatar` prop defined

# Proposed Solutions

## Option A: Deterministic fallback ID from message ID + index (recommended)
```typescript
// In processedMessages map, pass the message.id and index into the tool call builder:
id: toolCall.id ?? `${message.id}-tool-${toolCallIndex}`,
```
This is stable across re-renders since message IDs are stable.

## Option B: crypto.randomUUID() generated once outside the memo
Store synthetic IDs in a `useRef` map keyed by some stable identifier. More complex.

**Recommended: Option A.** Simple, deterministic, no refs needed.

**Also fix:** Remove the `showAvatar` computation (lines 125–131 collapse to `return processedArray;`).

# Technical Details
- Affected file: `apps/web/src/app/components/ChatInterface.tsx`
- The root cause of unstable IDs is server-side: LangGraph should always assign tool call IDs. But the client fallback should be stable regardless.

# Acceptance Criteria
- [ ] Tool call ID fallback is deterministic (no `Math.random()`)
- [ ] `ToolCallBox` does not remount on SSE chunks for unchanged messages
- [ ] `showAvatar` dead computation removed

# Work Log
- 2026-02-20: Created from multi-agent review of 4A+4B chat port PR
