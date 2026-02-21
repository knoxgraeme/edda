---
status: pending
priority: p3
issue_id: "017"
tags: [code-review, quality]
dependencies: []
---

# Problem Statement
`parseInt(rows[0].total, 10)` in getPendingConfirmationsCount returns NaN if the database returns no rows or a null value. This propagates NaN to the frontend dashboard instead of a safe default of 0.

# Findings
The dashboard query function does not handle the edge case of an empty database or null aggregate result. When no pending confirmations exist, the COUNT query may return null or an empty result set, causing parseInt to produce NaN.

- `packages/db/src/dashboard.ts` — getPendingConfirmationsCount uses `parseInt(rows[0].total, 10)` without a fallback

# Proposed Solutions
## Option A: Use safe numeric coercion with fallback
- Replace `parseInt(rows[0].total, 10)` with `Number(rows[0]?.total) || 0`
- Effort: Small

# Technical Details
- Affected files: `packages/db/src/dashboard.ts`

# Acceptance Criteria
- [ ] getPendingConfirmationsCount returns 0 (not NaN) on an empty database
- [ ] getPendingConfirmationsCount returns 0 when the query result is null
