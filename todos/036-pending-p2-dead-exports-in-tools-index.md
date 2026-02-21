---
status: pending
priority: p2
issue_id: "036"
tags: [code-review, simplicity, agent-tools]
dependencies: []
---

# Dead Schema and Named Tool Re-exports in tools/index.ts

## Problem Statement
`index.ts` has 36 lines of dead exports: 23 lines of schema re-exports and 13 lines of named tool re-exports. No file in the codebase imports any `*Schema` from the tools barrel, and the named re-exports are inconsistent (missing all 7 item tools).

## Findings
- **Source**: code-simplicity-reviewer, kieran-typescript-reviewer
- **File**: `apps/server/src/agent/tools/index.ts:48-71` — 23 lines of `*Schema` exports with zero consumers
- **File**: `apps/server/src/agent/tools/index.ts:33-46` — 13 lines of named tool re-exports, inconsistently missing item tools
- The `eddaTools` array is the only consumer; it uses local imports directly
- The schemas are already accessible via each tool's `schema` property

## Proposed Solutions

### Option A: Remove all dead exports (Recommended)
Strip index.ts to just imports + `eddaTools` array. ~58 LOC removed.
- Pros: Clean barrel, no maintenance burden
- Cons: If a consumer emerges later, re-exports are a one-line add
- Effort: Very small
- Risk: None

## Acceptance Criteria
- [ ] index.ts contains only imports and `eddaTools` array export
- [ ] No dead re-exports

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | |

## Resources
- PR commit: 960f19d
