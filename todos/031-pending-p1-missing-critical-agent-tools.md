---
status: pending
priority: p1
issue_id: "031"
tags: [code-review, agent-native, agent-tools]
dependencies: []
---

# Missing Critical Agent Tools: delete_item, get_item_by_id, get_agent_knowledge

## Problem Statement
Three fundamental agent capabilities have no tool despite DB functions existing:
1. **delete_item** — `deleteItem()` exists in items.ts:62, `tool_call_limit_delete` setting exists, but no tool. Agent cannot fulfill "delete that" requests.
2. **get_item_by_id** — `getItemById()` exists in items.ts:30, but no tool. Agent cannot look up a specific item by ID (needed after create, after search, for verification).
3. **get_agent_knowledge** — `getAgentKnowledge()` exists in items.ts:196, but no tool. Agent cannot review its own learned preferences/facts/patterns without a semantic query. Skills like `weekly_reflect` and `memory_extraction` need this.

All three were in the original TODO list in the old index.ts but were dropped during implementation.

## Findings
- **Source**: agent-native-reviewer
- **File**: `apps/server/src/agent/tools/index.ts` — original TODO listed all three
- **File**: `packages/db/src/items.ts` — DB functions exist for all three
- **File**: `packages/db/src/types.ts:58` — `tool_call_limit_delete` setting implies delete was planned
- MCP connections have full CRUD; items are missing Read-by-ID and Delete

## Proposed Solutions

### Option A: Add all 3 tools (Recommended)
Create `delete-item.ts`, `get-item-by-id.ts`, `get-agent-knowledge.ts` following existing tool patterns.
- `delete_item`: Check `tool_call_limit_delete` setting, call `deleteItem(id)`
- `get_item_by_id`: Call `getItemById(id)`, return item fields
- `get_agent_knowledge`: Call `getAgentKnowledge()` with optional orderBy/limit params
- Pros: Completes the core CRUD surface
- Cons: 3 more tool files
- Effort: Small
- Risk: Low

## Acceptance Criteria
- [ ] `delete_item` tool exists and respects rate limit setting
- [ ] `get_item_by_id` tool exists and returns item details
- [ ] `get_agent_knowledge` tool exists with ordering/limit options
- [ ] All three registered in eddaTools array
- [ ] System prompt updated if needed

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | These were planned but dropped during implementation |

## Resources
- PR commit: 960f19d
- DB functions: items.ts lines 30, 62, 196
