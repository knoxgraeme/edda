---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, security]
dependencies: []
---

# Problem Statement
All three update functions (updateItem, updateEntity, updateMcpConnection) build SQL SET clauses by interpolating Object.keys() directly into query strings. At runtime, any key passed could inject arbitrary SQL. The TypeScript type constraint only applies at compile time and offers no runtime protection, meaning a malicious or malformed input object could execute arbitrary SQL against the database.

# Findings
Flagged by: kieran-typescript-reviewer (Critical), security-sentinel (Critical)

- `packages/db/src/items.ts` — `updateItem` function uses dynamic key interpolation in SET clause
- `packages/db/src/entities.ts` — `updateEntity` function uses dynamic key interpolation in SET clause
- `packages/db/src/mcp-connections.ts` — `updateMcpConnection` function uses dynamic key interpolation in SET clause

All three follow the same pattern: iterating over `Object.keys()` of the input object and embedding the key names directly into the SQL string without any validation or escaping.

# Proposed Solutions
## Option A: Whitelist allowed columns
- Add a `const ALLOWED_COLUMNS = [...]` for each table and validate keys against it before interpolation. Reject or strip any key not in the whitelist.
- Pros: Minimal code change, easy to review, keeps the dynamic SET builder pattern
- Cons: Must maintain the whitelist in sync with schema changes
- Effort: Small
- Risk: Low

## Option B: Explicit parameterized UPDATE per column
- Replace the dynamic SET builder with explicit, hardcoded parameterized UPDATE statements for each supported column.
- Pros: No dynamic SQL at all, maximum safety
- Cons: More verbose, requires updating function signatures when columns change
- Effort: Medium
- Risk: Low

# Technical Details
- Affected files:
  - `packages/db/src/items.ts` (updateItem)
  - `packages/db/src/entities.ts` (updateEntity)
  - `packages/db/src/mcp-connections.ts` (updateMcpConnection)

# Acceptance Criteria
- [ ] No string interpolation of column names in any SQL query across updateItem, updateEntity, and updateMcpConnection
- [ ] All column names validated against a whitelist or hardcoded in parameterized queries
- [ ] Existing tests (if any) continue to pass
- [ ] New tests added to verify that invalid column names are rejected
