---
status: complete
priority: p1
issue_id: "030"
tags: [code-review, security, agent-tools]
dependencies: ["019"]
---

# Unrestricted Settings Mutation via update_settings Tool

## Problem Statement
The `update_settings` tool accepts `z.record(z.any())` — the agent can overwrite ANY column in the settings table with no allowlist. This includes security-sensitive fields like `llm_provider`, `default_model`, `system_prompt_override`, `tool_call_limit_global`, `tool_call_limit_delete`, all `approval_*` gates, and `langgraph_platform_url` (SSRF vector).

The DB function `updateSettings` in settings.ts also interpolates key names directly into SQL SET clauses without sanitization (related to todo 019).

## Findings
- **Source**: security-sentinel, code-simplicity-reviewer, agent-native-reviewer
- **File**: `apps/server/src/agent/tools/update-settings.ts` — schema is `z.record(z.any())`
- **File**: `packages/db/src/settings.ts:38` — `${k} = $${i + 1}` no quoting, no allowlist
- The LLM directly controls the keys, making this the most exploitable finding
- `get_settings` also exposes full settings including infrastructure URLs

## Proposed Solutions

### Option A: Agent-mutable allowlist in tool + DB allowlist (Recommended)
Add `AGENT_MUTABLE_KEYS` set in update-settings.ts filtering which keys the agent can change. Add `SETTINGS_COLUMNS` allowlist in settings.ts for defense-in-depth.
- Pros: Defense in depth, minimal code change
- Cons: Must maintain two lists
- Effort: Small
- Risk: Low

### Option B: Typed Zod schema with explicit fields
Replace `z.record(z.any())` with explicit optional fields for each safe setting.
- Pros: Full type safety, self-documenting
- Cons: More verbose, must update schema when adding settings
- Effort: Medium
- Risk: Low

## Acceptance Criteria
- [ ] update_settings tool only allows agent-safe keys
- [ ] settings.ts validates column names against an allowlist
- [ ] get_settings redacts infrastructure/internal fields
- [ ] z.any() replaced with z.unknown() at minimum

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | Overlaps with todo 019 (column quoting) |
| 2026-02-20 | Fixed in commit cde337f, PR #1 | |

## Resources
- PR commit: 960f19d
- Related: todo 019 (settings column injection)
