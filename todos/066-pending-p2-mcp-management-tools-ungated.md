---
status: pending
priority: p2
issue_id: "066"
tags: [code-review, security, agent-tools, mcp]
dependencies: []
---

# Agent MCP Management Tools Not Gated by Approval

## Problem Statement
`add_mcp_connection` and `remove_mcp_connection` allow the agent to register new MCP servers (pointing to arbitrary URLs) and remove existing ones without any human confirmation. Combined with prompt injection via MCP tool descriptions, an adversarial server can instruct the agent to add an attacker-controlled MCP endpoint, permanently expanding the attack surface.

## Findings
- **Source**: security-sentinel
- **File**: `apps/server/src/agent/tools/add-mcp-connection.ts` — no approval gate
- **File**: `apps/server/src/agent/tools/remove-mcp-connection.ts` — unconditional hard delete, no confirmation
- `remove_mcp_connection` does not check for a `system_managed` flag or similar
- The approval system exists for item types and entities but is not applied to MCP connections

## Proposed Solutions

### Option A: Gate behind approval system (Recommended)
Route MCP connection creation through `confirmed = false` like item types when `approval_new_type = "confirm"`. Add a new setting `approval_mcp_connection`.
- Pros: Consistent with existing approval pattern, human stays in loop
- Cons: Slightly more complex, new setting needed
- Effort: Small-Medium
- Risk: Low

### Option B: Remove from agent tool set
Make MCP management CLI/frontend-only.
- Pros: Simplest, eliminates attack vector entirely
- Cons: Agent loses ability to help user configure integrations
- Effort: Very small
- Risk: Low

## Acceptance Criteria
- [ ] Agent cannot add MCP connections without human approval
- [ ] Agent cannot remove system-managed MCP connections
- [ ] Approval workflow exists for MCP connection changes

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | security-sentinel flagged |

## Resources
- `apps/server/src/agent/tools/add-mcp-connection.ts`
- `apps/server/src/agent/tools/remove-mcp-connection.ts`
