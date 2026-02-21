---
status: pending
priority: p2
issue_id: "066"
tags: [code-review, security, plan-1i]
dependencies: []
---

# No Rate Limiting — Unbounded Agent Invocations

## Problem Statement
Each `POST /api/stream` request invokes the LLM (with associated API cost). The double-texting mutex only prevents concurrent requests on the same thread. An attacker can generate unlimited UUIDs to bypass it, causing API cost exhaustion and DB connection pool exhaustion.

## Findings
- No rate limiting middleware in plan
- Each request calls `agent.stream()` which calls external LLM API
- Plan says "reverse proxy handles auth" but doesn't mention rate limits
- Agent: Security Sentinel (P2-02)

## Proposed Solutions

### Option A: Application-level rate limiting (Recommended)
Add `express-rate-limit` or equivalent:
```typescript
app.use("/api/stream", rateLimit({
  windowMs: 60_000,
  max: 20, // 20 requests per minute per IP
}));
```
- **Effort:** Small | **Risk:** Low

### Option B: Document reverse proxy rate limiting
Add to deployment docs that the reverse proxy should enforce rate limits. No application-level change.
- **Effort:** Small | **Risk:** Medium (depends on deployment)

## Acceptance Criteria
- [ ] Either app-level or documented proxy-level rate limiting exists
- [ ] LLM API cannot be exhausted by rapid requests
