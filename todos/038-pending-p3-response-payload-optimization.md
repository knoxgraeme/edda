---
status: pending
priority: p3
issue_id: "038"
tags: [code-review, performance, agent-tools]
dependencies: []
---

# Response Payload Optimization for LLM Context

## Problem Statement
Several tools manually map response fields or return large payloads that consume LLM context window tokens unnecessarily.

## Findings
- **Source**: performance-oracle, code-simplicity-reviewer
- **get-timeline.ts** — Returns up to 200 items with full `content`. At 500 chars avg per item = ~160KB = ~40K tokens. Should default to 50 and prefer `summary` over `content`.
- **get-list-items.ts, get-timeline.ts, search-items.ts** — Manually cherry-pick fields in `.map()`. Since the consumer is an LLM (not a typed API client), the field mapping adds boilerplate without value. Could return raw rows or use summary-only mode.
- **add-mcp-connection.ts** — Conditionally builds config object when `{ url, description, auth_header }` would work (undefined stripped by JSON.stringify).

## Proposed Solutions

### Option A: Reduce defaults + simplify mapping (Recommended)
- Lower get_timeline default limit to 50
- Return `summary || content.slice(0, 200)` instead of full content in list/timeline responses
- Simplify field mapping in responses
- Effort: Small
- Risk: Low

## Acceptance Criteria
- [ ] get_timeline defaults to 50, returns summaries
- [ ] Response payloads optimized for LLM context consumption

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | |

## Resources
- PR commit: 960f19d
