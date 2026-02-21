---
status: complete
priority: p1
issue_id: "061"
tags: [code-review, security, agent-tools, access-control]
dependencies: []
---

# confirm_pending / reject_pending Self-Approval Bypass

## Problem Statement
The approval system (`approval_new_type`, `approval_archive_stale`, `approval_merge_entity`) exists to gate agent actions behind human confirmation. However, the `confirm_pending` and `reject_pending` tools are in the agent's own tool set with no restrictions. The agent can create a pending record and immediately confirm it, completely bypassing the human-in-the-loop approval workflow.

## Findings
- **Source**: security-sentinel
- **File**: `apps/server/src/agent/tools/confirm-pending.ts` — no ownership or human-only check
- **File**: `apps/server/src/agent/tools/reject-pending.ts` — same issue
- **File**: `apps/server/src/agent/tools/index.ts` — both tools registered in `eddaTools`
- Attack vector: adversarial MCP tool description instructs agent to create item type + immediately confirm it
- The entire approval workflow is rendered moot if the agent can self-approve

## Proposed Solutions

### Option A: Remove from agent tool set (Recommended)
Remove `confirmPendingTool` and `rejectPendingTool` from `eddaTools`. These become user-only actions via the frontend `/inbox` page or a CLI command.
- Pros: Clean separation — agent proposes, human disposes
- Cons: Agent cannot help user manage inbox (but shouldn't be able to)
- Effort: Very small (remove 2 lines from index.ts)
- Risk: Low — the tools still exist for the frontend API

### Option B: Add creator tracking + ownership check
Track which agent session created the pending record and prevent the same session from confirming it.
- Pros: Agent can still help manage inbox for items it didn't create
- Cons: More complex, session tracking needed, still exploitable across sessions
- Effort: Medium
- Risk: Medium — complexity adds attack surface

## Acceptance Criteria
- [ ] Agent cannot confirm or reject its own pending actions
- [ ] Frontend/API can still confirm/reject pending items
- [ ] Approval workflow is genuinely human-gated

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | security-sentinel flagged |
| 2026-02-20 | Fixed | Addressed in agent factory review fixes commit |
## Resources
- `apps/server/src/agent/tools/confirm-pending.ts`
- `apps/server/src/agent/tools/reject-pending.ts`
- `apps/server/src/agent/tools/index.ts`
