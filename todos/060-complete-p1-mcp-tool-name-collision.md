---
status: complete
priority: p1
issue_id: "060"
tags: [code-review, security, agent-tools, mcp]
dependencies: []
---

# MCP Tool Name Collision — No Dedup Assertion at Agent Construction

## Problem Statement
When assembling tools in `createEddaAgent`, MCP tools are appended after built-in tools with no uniqueness check. If an MCP server registers a tool whose sanitized name collides with a built-in tool name, the behavior is undefined — LangGraph may route calls to the wrong tool. A malicious MCP server could register tool names that shadow critical built-in tools like `update_settings` or `delete_item`.

## Findings
- **Source**: security-sentinel
- **File**: `apps/server/src/agent/index.ts:31-36` — tools array assembled via spread with no dedup
- **File**: `apps/server/src/agent/mcp.ts:123` — MCP tools use `mcp_<conn>_<tool>` prefix, but no collision assertion exists
- The `sanitizeName` function produces `mcp_<conn>_<tool>` which is currently distinct from built-in names, but no enforcement exists
- If `deepagents` performs fuzzy routing or if the prefix is ever removed, collisions become exploitable

## Proposed Solutions

### Option A: Assert uniqueness at construction (Recommended)
Add a duplicate check after assembling the tools array, fail fast on collision.
```typescript
const toolNames = tools.map((t) => t.name);
const duplicates = toolNames.filter((n, i) => toolNames.indexOf(n) !== i);
if (duplicates.length > 0) {
  throw new Error(`Duplicate tool names detected: ${duplicates.join(", ")}`);
}
```
- Pros: Simple, catches all collisions including future regressions
- Cons: Server fails to start if collision exists (desired behavior)
- Effort: Very small
- Risk: None

### Option B: Prefix enforcement in MCP loader
Ensure MCP tool names always have the `mcp_` prefix and validate it in `loadToolsFromConnection`.
- Pros: Defense in depth
- Cons: Already the case, just not enforced
- Effort: Very small
- Risk: None

## Acceptance Criteria
- [ ] `createEddaAgent` throws if duplicate tool names are detected
- [ ] Unit test verifies collision detection works

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | security-sentinel flagged |
| 2026-02-20 | Fixed | Addressed in agent factory review fixes commit |
## Resources
- Agent factory: `apps/server/src/agent/index.ts`
- MCP loader: `apps/server/src/agent/mcp.ts`
