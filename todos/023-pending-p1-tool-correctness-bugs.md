---
status: complete
priority: p1
issue_id: "023"
tags: [code-review, correctness, agent-tools]
dependencies: []
---

# Problem Statement
Two agent tools have silent correctness bugs that cause the agent to believe it has done something it hasn't:

1. **`create_item_type`** — the Zod schema accepts `dashboard_section`, `completable`, `has_due_date`, and `is_list` but the handler destructures only `{ name, description, extraction_hint, metadata_schema, icon }`. The four extra fields are silently dropped. The LLM is told it can set these fields, and it will try, but they have no effect.

2. **`search_items` `after` filter** — the `after` date parameter is applied in JavaScript *after* fetching `limit` results from Postgres. With `limit=10` and a narrow `after` date, Postgres returns 10 old results, all of which are filtered out, silently returning nothing. The `after` constraint must be pushed into the SQL query.

# Findings
Flagged by: agent-native-reviewer (Warning), code-simplicity-reviewer (correctness bug)

- `apps/server/src/agent/tools/create-item-type.ts` line 25: destructure missing `dashboard_section`, `completable`, `has_due_date`, `is_list`
- `apps/server/src/agent/tools/search-items.ts` lines 30–33: `const filtered = after ? results.filter((r) => r.day >= after) : results;` — post-query filter
- `packages/db/src/items.ts` `searchItems()`: does not currently accept an `after` date parameter

# Proposed Solutions

## Fix 1: create-item-type — pass through all schema fields
Add the missing fields to the destructure and pass them to `createItemType`. If `createItemType` in `@edda/db` doesn't yet accept them, update the DB function to accept and persist them.

```typescript
const { name, description, extraction_hint, metadata_schema, icon, dashboard_section, completable, has_due_date, is_list } = input;
const itemType = await createItemType({
  name, description, classification_hint: extraction_hint, metadata_schema,
  icon: icon ?? "📦", dashboard_section, completable, has_due_date, is_list,
});
```

## Fix 2: search-items — push `after` into SQL
Add `after?: string` to the `searchItems` options in `packages/db/src/items.ts` and include it as a `WHERE day >= $N` condition in the query. Remove the JavaScript post-filter.

# Technical Details
- `apps/server/src/agent/tools/create-item-type.ts`
- `apps/server/src/agent/tools/search-items.ts`
- `packages/db/src/items.ts` (needs `after` parameter added to `searchItems`)

# Acceptance Criteria
- [ ] `create_item_type` tool passes all schema fields to `createItemType`
- [ ] `searchItems` accepts `after` as a SQL-level filter
- [ ] `search_items` tool removes the JavaScript post-filter
- [ ] `pnpm type-check` passes

# Work Log
- 2026-02-20: Created from agent-native and simplicity review of 4A+4B chat port PR
