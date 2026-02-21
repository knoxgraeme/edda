---
status: pending
priority: p3
issue_id: "037"
tags: [code-review, agent-native, agent-tools]
dependencies: ["031"]
---

# Missing Secondary Agent Tools

## Problem Statement
Several DB functions have no corresponding agent tool. These are less critical than the P1 missing tools (031) but would improve agent capability:
- **search_entities** — `searchEntities()` exists in entities.ts:73 but no tool. Agent can't do fuzzy entity lookup.
- **list_item_types** — `getItemTypes()` exists in item-types.ts:8 but no tool. Agent can't refresh its view of types mid-conversation.
- **update_entity** — `updateEntity()` exists in entities.ts:36 but no tool. Agent can't modify entity description/aliases after creation.
- **get_items_by_type** — `getItemsByType()` exists in items.ts:228 but no tool. Useful for "show me all my tasks."
- **get_top_entities** — `getTopEntities()` exists in entities.ts:149 but no tool.

Additionally:
- `upsert_entity` is named "upsert" but is actually just INSERT (no ON CONFLICT). Will error on duplicate names.
- `add_mcp_connection` hardcodes `transport: "sse"` — should accept all 3 transport types.
- `list_mcp_connections` only returns enabled connections.
- No `unlink_item_entity` tool.

## Proposed Solutions

### Option A: Add tools incrementally as needed
Implement search_entities and list_item_types first (most useful), defer others.
- Effort: Medium (2-3 new tools)
- Risk: Low

### Option B: Add all missing tools
Full coverage of all DB functions.
- Effort: Large (8+ new tools)
- Risk: Low

## Acceptance Criteria
- [ ] At minimum: search_entities and list_item_types tools exist
- [ ] upsert_entity actually performs upsert (ON CONFLICT)
- [ ] add_mcp_connection accepts transport parameter

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | |

## Resources
- PR commit: 960f19d
