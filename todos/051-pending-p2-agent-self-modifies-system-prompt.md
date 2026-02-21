---
status: pending
priority: p2
issue_id: "051"
tags: [code-review, security]
dependencies: []
---

# Agent Can Modify Own System Prompt + Bypass Approval Workflow

## Problem Statement
`AGENT_MUTABLE_KEYS` includes `system_prompt_override`, allowing the LLM agent to modify its own system prompt — a prompt injection persistence vector. Additionally, `update_item` exposes `confirmed` and `pending_action` fields, letting the agent bypass the approval workflow by directly confirming pending items.

## Findings
- **update-settings.ts lines 13-28:** `system_prompt_override` in `AGENT_MUTABLE_KEYS`
- **update-item.ts lines 19, 42:** `confirmed: z.boolean().optional()`, `pending_action` exposed
- If attacker gets LLM to call `update_settings` with malicious prompt, all future conversations affected
- Agent can silently confirm items, bypassing `confirm_pending`/`reject_pending` workflow
- Agent: Security Sentinel (F5, F8)

## Proposed Solutions

### Option A: Remove from Agent-Mutable + Strip from update_item (Recommended)
Remove `system_prompt_override` from `AGENT_MUTABLE_KEYS`. Remove `confirmed` and `pending_action` from `updateItemSchema`.
- **Effort:** Small | **Risk:** Low

### Option B: Gate Behind Confirmation
Keep agent-mutable but require user confirmation for prompt changes.
- **Effort:** Medium | **Risk:** Low

## Acceptance Criteria
- [ ] Agent cannot modify system prompt without user-initiated action
- [ ] Item confirmation only possible through dedicated confirm/reject tools

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Security Sentinel |
