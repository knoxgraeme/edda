---
status: complete
priority: p3
issue_id: "016"
tags: [code-review, agent-native]
dependencies: []
---

# Problem Statement
The capture SKILL.md instructs the agent to "Read references/types.md" and "Always consult it before extracting metadata," but the file is an empty stub. No generator exists yet to populate it, so the agent is told to rely on a file that contains nothing.

# Findings
The capture skill's reference file exists but is empty. The SKILL.md documentation promises type definitions that are never generated, leaving the agent without the context it needs for metadata extraction.

- `apps/server/skills/capture/references/types.md` — empty stub file
- `apps/server/skills/capture/SKILL.md` — references types.md as required reading

# Proposed Solutions
## Option A: Build a types.md generator
- Create a generator function that queries the item_types table and writes markdown output to types.md
- Follow the same pattern as the existing generateAgentsMd function
- Run the generator on server startup to keep the file current
- Effort: Small

# Technical Details
- Affected files:
  - `apps/server/skills/capture/references/types.md`
  - New generator function (follow generateAgentsMd pattern)
  - Server startup sequence to invoke the generator

# Acceptance Criteria
- [ ] types.md is auto-generated with current item type definitions on server startup
- [ ] Generated content includes field definitions and metadata schemas from item_types table

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Fixed in commit d059e8a, PR #1 | |
