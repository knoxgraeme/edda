---
status: complete
priority: p2
issue_id: "024"
tags: [code-review, performance, react]
dependencies: []
---

# Problem Statement
Three related performance issues in the chat UI that are acceptable at low message counts but will cause visible jank as conversations grow:

1. **O(N*M*K) tool correlation** — `processedMessages` memo iterates all AI messages for every tool result message. At 50 AI messages with tool calls this becomes measurable.
2. **One `setState` per SSE token** — `setMessages` is called inside the SSE line loop, scheduling a React re-render per token (~20–40/s). React 18 batching doesn't help because `await reader.read()` yields between calls.
3. **`React.memo` bypass** — `toolCalls` arrays are recreated in `processedMessages` on every memo run, so `React.memo` on `ChatMessage` never bails out. Historical completed messages re-render on every streaming token.

# Findings
Flagged by: performance-oracle (Priority 1 and 2)

- `apps/web/src/app/components/ChatInterface.tsx` lines 100–115: O(N*M*K) tool message correlation loop
- `apps/web/src/app/hooks/useEdda.ts` line 108: `setMessages` inside per-line loop
- `apps/web/src/app/components/ChatMessage.tsx` line 15: `React.memo` with no custom comparator

# Proposed Solutions

## Fix 1: O(1) reverse index for tool correlation
Build a `toolCallIdToAiId` Map during the AI message pass:
```typescript
const toolCallIdToAiId = new Map<string, string>(); // tool_call_id → ai message.id
// During AI message processing: toolCallsWithStatus.forEach(tc => toolCallIdToAiId.set(tc.id, message.id))
// During tool message processing: const aiId = toolCallIdToAiId.get(toolCallId); // O(1)
```

## Fix 2: Batch setState per reader.read() call
Collect all chunks from one `reader.read()` call into an array, then call `setMessages` once:
```typescript
const chunksThisBatch: Message[] = [];
for (const line of lines) { /* collect chunks */ }
if (chunksThisBatch.length > 0) {
  setMessages(prev => chunksThisBatch.reduce(mergeMessageChunk, prev));
}
```

## Fix 3: Custom areEqual comparator on ChatMessage
```typescript
export const ChatMessage = React.memo(Component, (prev, next) => {
  if (prev.message.content !== next.message.content) return false;
  if (prev.toolCalls.length !== next.toolCalls.length) return false;
  return prev.toolCalls.every((tc, i) =>
    tc.status === next.toolCalls[i].status && tc.result === next.toolCalls[i].result
  );
});
```

# Technical Details
- `apps/web/src/app/components/ChatInterface.tsx`
- `apps/web/src/app/hooks/useEdda.ts`
- `apps/web/src/app/components/ChatMessage.tsx`

# Acceptance Criteria
- [ ] Tool correlation is O(N) total, not O(N*M*K)
- [ ] SSE streaming causes at most one `setMessages` per network packet
- [ ] Historical completed messages do not re-render during active streaming
- [ ] Subjectively smooth at 100+ message conversations

# Work Log
- 2026-02-20: Created from performance-oracle review of 4A+4B chat port PR
