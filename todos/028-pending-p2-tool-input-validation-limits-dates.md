---
status: complete
priority: p2
issue_id: "028"
tags: [code-review, security, validation]
dependencies: []
---

# Problem Statement
Several agent tools accept unbounded or unvalidated inputs that can cause DoS or confusing silent failures:
- `limit` fields in search/list tools have no `.max()` — the LLM could request millions of rows
- Date string fields (`start`, `end`, `day`) accept any string with no format validation — bad dates cause runtime Postgres errors with potentially leaky error messages

# Findings
Flagged by: security-sentinel (Medium)

- `apps/server/src/agent/tools/search-items.ts` line 14: `z.number().optional()` — no max
- `apps/server/src/agent/tools/get-timeline.ts` lines 10–12: `z.string()` dates — no regex
- `apps/server/src/agent/tools/get-entity-items.ts` line 11: `z.number().optional()` — no max
- `apps/server/src/agent/tools/get-list-items.ts`: check for limit field
- Pattern should be applied consistently to all tools with date or limit params

# Proposed Solutions

Add constraints to all relevant Zod schemas:

```typescript
// Limit fields
limit: z.number().int().min(1).max(100).default(10),

// Date fields
start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
```

# Technical Details
- `apps/server/src/agent/tools/search-items.ts`
- `apps/server/src/agent/tools/get-timeline.ts`
- `apps/server/src/agent/tools/get-entity-items.ts`
- Any other tool file with `limit` or date string parameters

# Acceptance Criteria
- [ ] All `limit` fields have `.max(100)` or similar reasonable cap
- [ ] All date string fields have `.regex(/^\d{4}-\d{2}-\d{2}$/)` validation
- [ ] `pnpm type-check` passes

# Work Log
- 2026-02-20: Created from security-sentinel review of 4A+4B chat port PR
