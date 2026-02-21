---
status: pending
priority: p3
issue_id: "059"
tags: [code-review, quality]
dependencies: []
---

# Minor Tool Quality Issues — Nullish Coalescing, Transport, Existence Checks

## Problem Statement
Several minor quality issues across tool files that don't affect correctness individually but represent inconsistencies.

## Findings
- **batch-create-items.ts:37-38:** Uses `||` instead of `??` for defaults (`day: item.day || today`). Empty string for day would be replaced.
- **add-mcp-connection.ts:29:** Hardcodes `transport: "sse"` but MCP supports stdio and streamable-http. No way for agent to create non-SSE connections.
- **remove-mcp-connection.ts:** Does not verify existence before deletion — always returns `status: "removed"` even for non-existent IDs.
- **Dynamic column allowlists:** Could add regex guard (`/^[a-z][a-z0-9_]*$/`) for defense-in-depth against future regression.
- Agent: TypeScript Reviewer (#13, #14), Simplicity Reviewer, Security Sentinel (F1)

## Proposed Solutions

### Option A: Fix All (Recommended)
1. Replace `||` with `??` in batch-create-items
2. Add transport param to add-mcp-connection schema (default "sse")
3. Check rowCount in remove-mcp-connection, return `not_found` if 0
4. Add SAFE_IDENTIFIER regex to column allowlist checks
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] Nullish coalescing used consistently
- [ ] remove_mcp_connection returns appropriate status for missing IDs
- [ ] Column allowlists have regex defense-in-depth

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by TypeScript Reviewer, Security Sentinel |
