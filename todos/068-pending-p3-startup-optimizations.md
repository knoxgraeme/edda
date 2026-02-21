---
status: pending
priority: p3
issue_id: "068"
tags: [code-review, performance, startup]
dependencies: []
---

# Startup Optimizations — DDL Guard, Sequential readFile, MCP Prefix in Prompt

## Problem Statement
Three minor startup optimizations identified during review:
1. `PostgresSaver.setup()` runs DDL (`CREATE TABLE IF NOT EXISTS`) on every startup, causing unnecessary DB round-trips and potential lock contention in multi-instance deployments
2. `buildSystemPrompt()` reads AGENTS.md sequentially before fanning out DB queries — should be parallelized
3. System prompt lists MCP connections by name but doesn't explain the `mcp_<conn>_<tool>` naming scheme, leaving the agent to discover tool prefixes by inference

## Findings
- **Source**: performance-oracle, agent-native-reviewer
- **File**: `apps/server/src/checkpointer/index.ts:15-18` — `saver.setup()` on every boot
- **File**: `apps/server/src/agent/prompts/system.ts:34-44` — sequential readFile before Promise.all
- **File**: `apps/server/src/agent/prompts/system.ts` — MCP connections listed without tool prefix info

## Proposed Solutions

### Option A: Address all three (Recommended)
1. Guard `saver.setup()` behind `SKIP_CHECKPOINTER_SETUP` env var or move to migration
2. Move `readFile("./AGENTS.md")` into the existing `Promise.all` alongside DB queries
3. Add tool prefix hint to MCP connections section in system prompt
- Pros: Faster startup, better agent context
- Cons: Minimal complexity
- Effort: Small
- Risk: None

## Acceptance Criteria
- [ ] `PostgresSaver.setup()` can be skipped via env var
- [ ] AGENTS.md read is parallelized with DB queries in buildSystemPrompt
- [ ] System prompt includes MCP tool naming convention

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | |

## Resources
- `apps/server/src/checkpointer/index.ts`
- `apps/server/src/agent/prompts/system.ts`
