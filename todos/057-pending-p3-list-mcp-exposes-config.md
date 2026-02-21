---
status: pending
priority: p3
issue_id: "057"
tags: [code-review, security]
dependencies: []
---

# list_mcp_connections Exposes Full Config JSONB to Agent

## Problem Statement
The `list_mcp_connections` tool returns `JSON.stringify(connections)` including the full `config` JSONB blob. While auth tokens are stored as env var names (not values), the config may contain internal URLs, stdio commands, or env var names that reveal infrastructure details.

## Findings
- **list-mcp-connections.ts lines 11-15:** Returns full connection objects including config
- Risk increases if agent responses are logged or multi-user support is added
- Agent: Security Sentinel (F4)

## Proposed Solutions

### Option A: Filter to Safe Fields (Recommended)
Return only `id`, `name`, `transport`, `enabled`, and sanitized config summary.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] list_mcp_connections returns only non-sensitive fields
- [ ] Internal URLs and env var names are not exposed to agent

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Security Sentinel |
