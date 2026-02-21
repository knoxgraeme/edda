---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security]
dependencies: []
---

# Problem Statement
The `orderBy` parameter in `getAgentKnowledge` is interpolated directly into the SQL ORDER BY clause without any validation or whitelist. A caller could pass a malicious string such as `1; DROP TABLE items--` and it would execute as raw SQL. This is a critical SQL injection vulnerability.

# Findings
Flagged by: kieran-typescript-reviewer (Critical), security-sentinel (Critical)

- `packages/db/src/items.ts` — `getAgentKnowledge` function accepts an `orderBy` string parameter and embeds it directly into the query's ORDER BY clause via string interpolation.

# Proposed Solutions
## Option A: Whitelist map of allowed sort expressions
- Create a `const SORT_MAP = { recent: 'created_at DESC', relevant: 'similarity' }` and look up the caller's value from that map. Reject any value not in the map.
- Pros: Simple, safe, self-documenting, easy to extend
- Cons: Callers must use predefined sort keys instead of arbitrary expressions
- Effort: Small
- Risk: Low

## Option B: Remove the orderBy parameter entirely
- Hardcode the sort order inside the function. If only one sort order is ever used in practice, this eliminates the attack surface entirely.
- Pros: Simplest possible fix, zero attack surface
- Cons: Loses flexibility if multiple sort orders are needed
- Effort: Small
- Risk: Low

# Technical Details
- Affected files:
  - `packages/db/src/items.ts` (getAgentKnowledge function)

# Acceptance Criteria
- [ ] No raw string interpolation in ORDER BY clause
- [ ] Only validated/whitelisted sort expressions are used
- [ ] All callers of getAgentKnowledge updated to use the new sort key interface (if Option A)
- [ ] Passing an invalid sort key results in an error or falls back to a safe default

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit d059e8a, PR #1 | |
