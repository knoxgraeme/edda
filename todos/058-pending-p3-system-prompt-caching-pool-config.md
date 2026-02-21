---
status: pending
priority: p3
issue_id: "058"
tags: [code-review, performance]
dependencies: []
---

# System Prompt Caching and Pool Configuration

## Problem Statement
`buildSystemPrompt()` executes 2 DB queries (`getItemTypes`, `getMcpConnections`) on every conversation start despite these changing infrequently. The connection pool is created with no explicit size configuration (pg default: 10 connections), which could bottleneck under concurrent tool calls.

## Findings
- **prompts/system.ts lines 33-71:** 2 DB queries per conversation, no caching
- **packages/db/src/index.ts lines 28-36:** Pool created with only connectionString
- `getDashboard` alone uses 5 concurrent connections
- Item types and MCP connections change very rarely
- Agent: Performance Oracle (3.5, 3.8)

## Proposed Solutions

### Option A: Cache + Configure Pool (Recommended)
Cache itemTypes/mcpConnections with invalidation on mutation. Set `max: 20, idleTimeoutMillis: 30000`.
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] System prompt builder caches item types and MCP connections
- [ ] Cache invalidated when types or connections are modified
- [ ] Pool configured with explicit max, idle timeout, connection timeout

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Performance Oracle |
