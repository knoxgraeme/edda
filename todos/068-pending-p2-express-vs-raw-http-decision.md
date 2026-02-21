---
status: pending
priority: p2
issue_id: "068"
tags: [code-review, architecture, plan-1i]
dependencies: []
---

# Express vs Raw HTTP Decision Needs Resolution

## Problem Statement
The simplicity reviewer flags Express as YAGNI for 2 routes — the existing `health.ts` proves raw `http` works, and CORS/body-parsing can be done in ~15 lines manually. Other reviewers assume Express. The work breakdown spec mentions Express explicitly.

## Findings
- Simplicity reviewer: P1 — Express is overkill for 2 routes, adds 500KB + 2 deps
- Security/TypeScript reviewers: assume Express, recommend Express middleware (rate-limit, cors)
- Work breakdown spec line 349: "CORS middleware"
- `health.ts` already uses raw `http.createServer()`
- If more routes are planned (threads list, settings API), Express becomes justified
- Agent: Code Simplicity Reviewer (P1), competing reviewers

## Proposed Solutions

### Option A: Keep Express (Work breakdown alignment)
Express provides CORS, body parsing, rate limiting, and routing out of the box. More routes are likely coming. The 500KB cost is negligible.
- **Effort:** As planned | **Risk:** Low

### Option B: Raw http with manual helpers
~30 lines of CORS/body-parse/routing. Fewer deps but more hand-rolled code.
- **Effort:** Small | **Risk:** Low (but more code to maintain)

## Acceptance Criteria
- [ ] Decision is made and documented in the plan
- [ ] If Express: `createServer`/`startServer` split is justified or merged
- [ ] If raw http: CORS, body parsing, and routing handled manually
