---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, agent-native, architecture]
dependencies: []
---

# Problem Statement
The system prompt only includes static content and AGENTS.md. It does NOT inject runtime context: available item types (the agent needs these to classify input), approval settings, active MCP connections, or pending confirmation count. The agent will suffer "Context Starvation" -- it won't know what types exist or what approval modes are active, leading to incorrect classifications and behavior.

# Findings
Flagged by: **agent-native-reviewer** (Warning - should fix)

- `apps/server/src/agent/prompts/system.ts` — `buildSystemPrompt()` only includes static content and AGENTS.md. No dynamic context injection for item types, settings, or MCP connections.

# Proposed Solutions
## Option A: Expand buildSystemPrompt() to inject runtime context
- Query `getItemTypes()`, `getSettingsSync()`, `getMcpConnections()` at prompt build time.
- Inject as structured sections (e.g., "## Available Item Types", "## Approval Settings", "## Active MCP Connections").
- Pros: Agent gets full runtime awareness, better classification accuracy, correct approval behavior
- Cons: Adds async queries to prompt building, prompt length increases
- Effort: Medium
- Risk: Low

# Technical Details
- Affected files:
  - `apps/server/src/agent/prompts/system.ts`
- Related data sources:
  - `packages/db/src/item-types.ts` (`getItemTypes`)
  - `packages/db/src/settings.ts` (settings queries)
  - `packages/db/src/mcp-connections.ts` (`getMcpConnections`)

# Acceptance Criteria
- [ ] System prompt includes dynamic item types at runtime
- [ ] System prompt includes approval settings at runtime
- [ ] System prompt includes active MCP connections at runtime
- [ ] Prompt building handles query failures gracefully (fallback to static content)
