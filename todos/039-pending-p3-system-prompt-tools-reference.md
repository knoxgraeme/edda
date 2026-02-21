---
status: pending
priority: p3
issue_id: "039"
tags: [code-review, agent-native, agent-tools]
dependencies: ["031"]
---

# System Prompt Missing Tools Reference Section

## Problem Statement
The system prompt at `apps/server/src/agent/prompts/system.ts` describes the agent's role and rules but never lists available tools by name. It mentions "use batch_create_items" once but doesn't map capabilities to tool names. The LLM relies entirely on LangChain's automatic tool descriptions, with no guidance on when to use which tool (especially when tools overlap, e.g., search_items with agent_knowledge_only vs. get_agent_knowledge).

## Findings
- **Source**: agent-native-reviewer
- **File**: `apps/server/src/agent/prompts/system.ts` — no tools section
- Tool descriptions are good individually, but the agent lacks higher-level guidance

## Proposed Solutions

### Option A: Add "Available Tools" section to system prompt
Map capabilities to tool names. E.g., "To find items from memory, use `search_items`. To check today's status, use `get_dashboard`."
- Pros: Better tool selection by the LLM
- Cons: Must maintain alongside tool changes
- Effort: Small
- Risk: Low

## Acceptance Criteria
- [ ] System prompt includes a tools reference section
- [ ] Key capability-to-tool mappings documented
- [ ] Overlapping tools have clear usage guidance

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | |

## Resources
- PR commit: 960f19d
