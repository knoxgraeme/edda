---
status: pending
priority: p2
issue_id: "052"
tags: [code-review, performance, correctness]
dependencies: []
---

# getEntitiesByName Broken ILIKE Pattern and Aliases Matching

## Problem Statement
`getEntitiesByName` uses `%name%` leading wildcard preventing index use (full table scan), and the aliases check `$1 = ANY(aliases)` with `%name%` literal checks if the string `%name%` exists in aliases — not a substring match. `resolveEntity` has similar issues with `$1 ILIKE ANY(aliases)` requiring O(n*m) scan.

## Findings
- **entities.ts lines 64-71:** `ILIKE $1` with `%${name}%` — leading wildcard, no index
- **entities.ts lines 64-71:** `$1 = ANY(aliases)` with wildcarded string — wrong semantics
- **entities.ts lines 101-111:** `resolveEntity` O(n*m) aliases scan
- No GIN trigram index for substring search
- ILIKE metacharacters (`%`, `_`) in input not escaped
- Agent: Performance Oracle (3.2, 3.3), Security Sentinel (F9)

## Proposed Solutions

### Option A: Fix Semantics + Add GIN Index (Recommended)
Fix aliases to use proper substring matching. Add `pg_trgm` GIN index for ILIKE.
- **Effort:** Medium | **Risk:** Low

## Acceptance Criteria
- [ ] Aliases matching does proper case-insensitive substring search
- [ ] ILIKE metacharacters escaped in input
- [ ] GIN trigram index added for entity name search

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle, Security Sentinel |
