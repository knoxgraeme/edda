---
status: complete
priority: p2
issue_id: "064"
tags: [code-review, security, agent-tools]
dependencies: []
---

# get_settings Leaks Sensitive Fields — Needs Allowlist

## Problem Statement
The `get_settings` tool uses a redact-by-exclusion approach (`REDACTED_KEYS`) that only removes 6 infrastructure fields. All remaining fields are returned to the LLM context, including `system_prompt_override`, `llm_provider`, `embedding_provider`, threshold values, and rate limits. This information leaks to MCP tool responses and conversation history.

## Findings
- **Source**: security-sentinel
- **File**: `apps/server/src/agent/tools/get-settings.ts` — `REDACTED_KEYS` is too narrow
- Fields leaked: `system_prompt_override`, `llm_provider`, `default_model`, `embedding_provider`, `embedding_model`, all threshold values, all rate limits
- Attack value: provider fingerprinting, threshold exploitation, rate limit awareness

## Proposed Solutions

### Option A: Replace with explicit allowlist (Recommended)
Return only fields the agent genuinely needs: user preferences, approval modes, display settings.
```typescript
const AGENT_VISIBLE_KEYS = new Set([
  "user_display_name", "user_timezone",
  "web_search_enabled", "web_search_max_results",
  "memory_extraction_enabled", "user_crons_enabled",
  "approval_new_type", "approval_archive_stale", "approval_merge_entity",
  "agents_md_token_budget", "agents_md_max_per_category",
  "agents_md_max_versions", "agents_md_max_entities",
]);
```
- Pros: Explicit opt-in, secure by default, consistent with `AGENT_MUTABLE_KEYS` pattern
- Cons: Agent loses visibility into model/provider info (but shouldn't need it)
- Effort: Small
- Risk: Low

## Acceptance Criteria
- [ ] `get_settings` uses allowlist, not blocklist
- [ ] Infrastructure, provider, and threshold fields not returned to LLM
- [ ] Agent can still read user-facing settings it needs

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | security-sentinel flagged |
| 2026-02-20 | Fixed | Addressed in agent factory review fixes commit |
## Resources
- `apps/server/src/agent/tools/get-settings.ts`
