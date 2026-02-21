---
status: pending
priority: p2
issue_id: "067"
tags: [code-review, agent-native, parity]
dependencies: []
---

# Agent-Native Parity Gaps — SSE-Only MCP + Missing delete_item_type

## Problem Statement
Two agent-native parity gaps prevent the agent from performing actions available via direct DB access:
1. `add_mcp_connection` hard-codes `transport: "sse"` — stdio and streamable-http connections cannot be created by the agent
2. No `delete_item_type` tool exists, though `deleteItemType(name)` is available in the DB layer

## Findings
- **Source**: agent-native-reviewer
- **File**: `apps/server/src/agent/tools/add-mcp-connection.ts:28` — `transport: "sse"` hard-coded
- **File**: `apps/server/src/agent/tools/index.ts` — no `deleteItemTypeTool` registered
- **File**: `packages/db/src/item-types.ts:59` — `deleteItemType(name)` exists, guards against built-in types
- The MCP loader supports all 3 transports but the agent tool only creates SSE connections

## Proposed Solutions

### Option A: Add transport field to add_mcp_connection + create delete_item_type tool (Recommended)
1. Add `transport` field to `addMcpConnectionSchema` with SSE default
2. Add conditional schema fields for stdio (`command`, `args`, `env`) vs URL-based transports
3. Create `delete-item-type.ts` tool wrapping `deleteItemType(name)` from `@edda/db`
- Pros: Full CRUD parity for both resources
- Cons: stdio transport has security implications (see todo 045)
- Effort: Small
- Risk: Low (stdio gating depends on 045 resolution)

## Acceptance Criteria
- [ ] Agent can create MCP connections with any supported transport type
- [ ] Agent can delete user-created item types
- [ ] Built-in item types cannot be deleted

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | agent-native-reviewer flagged |

## Resources
- `apps/server/src/agent/tools/add-mcp-connection.ts`
- `packages/db/src/item-types.ts`
