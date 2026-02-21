---
status: complete
priority: p1
issue_id: "062"
tags: [code-review, performance, plan-1i]
dependencies: []
---

# No Backpressure Handling on SSE res.write()

## Problem Statement
The streaming loop calls `res.write()` without checking its return value. When it returns `false`, Node's internal buffer has exceeded `highWaterMark` (16KB). If the client reads slower than the agent produces chunks, memory grows unboundedly. A single slow client on a multi-tool agent run could cause OOM.

## Findings
- Plan Step 4 lines 165-168: `res.write(data: ${JSON.stringify(chunk)}\n\n)` in `for await` loop
- `res.write()` returns boolean indicating buffer state — ignored
- LLM agents with tool chains can emit hundreds of chunks rapidly
- Agent: Performance Oracle (P1)

## Proposed Solutions

### Option A: Check write return, await drain (Recommended)
```typescript
for await (const chunk of stream) {
  if (abortController.signal.aborted) break;
  const payload = `data: ${JSON.stringify(chunk)}\n\n`;
  const canContinue = res.write(payload);
  if (!canContinue) {
    await new Promise<void>((resolve) => res.once("drain", resolve));
  }
}
```
- **Effort:** Small (3 lines) | **Risk:** Low

## Acceptance Criteria
- [ ] `res.write()` return value is checked
- [ ] Stream pauses when client buffer is full
- [ ] Memory stays bounded during slow-client scenarios
