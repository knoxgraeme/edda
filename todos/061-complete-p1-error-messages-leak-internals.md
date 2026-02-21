---
status: complete
priority: p1
issue_id: "061"
tags: [code-review, security, plan-1i]
dependencies: []
---

# Error Messages Leak Internal Details to Client

## Problem Statement
Both the SSE error event and the health endpoint use `String(err)` to send error details to the client. Database errors from `pg` include connection strings (with credentials), table names, and query text. LangGraph errors may include API keys or internal tool names.

## Findings
- Plan Step 4 line 173: `res.write(data: ${JSON.stringify({ error: String(err) })})`
- Existing `health.ts` line 19: `res.end(JSON.stringify({ status: "error", error: String(err) }))`
- Agent: Security Sentinel (P1-02, P3-03), TypeScript Reviewer

## Proposed Solutions

### Option A: Generic client errors, detailed server logs (Recommended)
```typescript
// SSE catch block:
console.error(`Stream error [thread=${thread_id}]:`, err);
res.write(`data: ${JSON.stringify({ error: "An internal error occurred" })}\n\n`);

// Health handler:
console.error("Health check failed:", err);
res.status(503).json({ status: "error" });
```
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] No `String(err)` sent to clients in any response
- [ ] All errors logged server-side with context
- [ ] Client receives generic error messages only
