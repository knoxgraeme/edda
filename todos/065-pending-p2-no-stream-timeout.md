---
status: pending
priority: p2
issue_id: "065"
tags: [code-review, security, performance, plan-1i]
dependencies: []
---

# No Server-Side Stream Timeout — Mutex Starvation Risk

## Problem Statement
If `agent.stream()` hangs (LLM timeout, stuck tool), the thread ID remains locked in `activeThreads` forever. The abort signal only fires on client disconnect. A hung agent + connected client = permanent thread lock.

## Findings
- Plan lines 134-138, 175-176: activeThreads guard has no timeout
- AbortController only aborts on `req.on("close")` — no server-side trigger
- Agent: Security Sentinel (P2-01), Performance Oracle (P3)

## Proposed Solutions

### Option A: Server-side timeout with abort (Recommended)
```typescript
const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const timeout = setTimeout(() => abortController.abort(), STREAM_TIMEOUT_MS);
try {
  // ... stream logic ...
} finally {
  clearTimeout(timeout);
  activeThreads.delete(thread_id);
  res.end();
}
```
- **Effort:** Small (3 lines) | **Risk:** Low

## Acceptance Criteria
- [ ] Streams abort after configurable timeout (default 5 min)
- [ ] Mutex is released when timeout fires
- [ ] Timeout is cleared on normal completion
