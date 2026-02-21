---
status: complete
priority: p3
issue_id: "012"
tags: [code-review, agent-native]
dependencies: []
---

# Problem Statement
5 recall operations have DB functions but no tool stubs (even as comments): get_entity_items, get_list_items, get_timeline, resolve_entity, get_agent_knowledge. These will be forgotten in Phase 2 if not listed anywhere in the tools file.

# Findings
The agent tools index registers active tools but does not reference planned recall operations. The corresponding DB query functions exist in `packages/db` but there is no trace of them in the tool definitions. Without at least commented placeholders, these capabilities are likely to be overlooked when Phase 2 implementation begins.

- `apps/server/src/agent/tools/index.ts` — no mention of the 5 recall tools

# Proposed Solutions
## Option A: Add commented stubs for all 5 recall tools
- Add a clearly marked `// --- Phase 2: Recall Tools ---` section with commented-out tool definitions for get_entity_items, get_list_items, get_timeline, resolve_entity, and get_agent_knowledge
- Effort: Small

# Technical Details
- Affected files: `apps/server/src/agent/tools/index.ts`

# Acceptance Criteria
- [ ] All 5 planned recall tools have at least commented stubs in tools/index.ts
- [ ] Stubs reference the corresponding DB query functions they will call

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit d059e8a, PR #1 | |
