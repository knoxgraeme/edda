---
status: pending
priority: p2
issue_id: "045"
tags: [code-review, security]
dependencies: []
---

# MCP Stdio Transport — Command and Env Passthrough from Database

## Problem Statement
The `createTransport` function for `stdio` MCP connections reads command, args, and env from the database `config` JSONB and passes them directly to `StdioClientTransport`. While `add_mcp_connection` currently only creates SSE connections, `updateMcpConnection` allows writing arbitrary transport/config values. The `config.env` passthrough could override `PATH`, `LD_PRELOAD`, or other security-sensitive environment variables.

## Findings
- **File:** `apps/server/src/agent/mcp.ts` lines 26-29
- `add_mcp_connection` tool hardcodes `transport: "sse"`, but DB allows arbitrary values
- `config.env` passed directly without filtering security-sensitive keys
- Agent: Security Sentinel (F2)

## Proposed Solutions

### Option A: Command Allowlist + Env Filtering (Recommended)
Allow only specific commands (e.g., `npx`, `node`, `python`) and filter env to safe keys.
- **Effort:** Small | **Risk:** Low

### Option B: Disable Stdio for DB-Configured Connections
Only support SSE/HTTP for dynamically added connections; stdio requires local config file.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] Stdio commands are validated against an allowlist
- [ ] Env passthrough filters security-sensitive keys (PATH, LD_PRELOAD, etc.)

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Security Sentinel |
