---
status: complete
priority: p1
issue_id: "060"
tags: [code-review, security, plan-1i]
dependencies: []
---

# CORS Wildcard Default Allows Cross-Origin Exploitation

## Problem Statement
The streaming server plan defaults `CORS_ORIGIN` to `"*"`, which allows any website to make cross-origin requests to the Edda API. Even though the spec says "reverse proxy handles auth," CORS operates at the browser level *before* the proxy intervenes. An attacker could host a page that invokes the agent via a victim's browser, bypassing cookie/IP-based auth.

## Findings
- Plan Step 2: `CORS_ORIGIN: z.string().default("*")`
- Plan Step 4: `app.use(cors({ origin: config.CORS_ORIGIN }))`
- `config.ts` has no `CORS_ORIGIN` field currently
- Agent: Security Sentinel (P1-01)

## Proposed Solutions

### Option A: Default to localhost:3000 (Recommended)
Change default to `http://localhost:3000` for development. Require explicit `CORS_ORIGIN` in production deployments.
```typescript
CORS_ORIGIN: z.string().default("http://localhost:3000"),
```
- **Effort:** Small | **Risk:** Low

### Option B: Inline env read, skip config schema
Use `process.env.CORS_ORIGIN ?? "http://localhost:3000"` directly without adding to Zod config.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] CORS origin is NOT `"*"` by default
- [ ] Production deployments must set `CORS_ORIGIN` explicitly
- [ ] Dev works out of the box with localhost:3000
