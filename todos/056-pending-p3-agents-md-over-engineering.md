---
status: pending
priority: p3
issue_id: "056"
tags: [code-review, simplicity, yagni]
dependencies: []
---

# AGENTS.md Over-Engineering — History Versioning and Token Budget

## Problem Statement
`generate-agents-md.ts` includes 25 lines of filesystem archiving (copying AGENTS.md to timestamped files, pruning old versions) for a file that can be regenerated from the database at any time. Additionally, `enforceTokenBudget` is redundant with the `maxPerCategory` limit that already bounds content.

## Findings
- **generate-agents-md.ts:53-75:** `archiveCurrentVersion` — timestamps, copies, prunes
- **generate-agents-md.ts:34-48:** `enforceTokenBudget` — redundant with per-category limit
- Settings fields `agents_md_max_versions` and `agents_md_token_budget` only exist for these features
- AGENTS.md is generated from live DB state — git history serves as audit trail
- Agent: Simplicity Reviewer (#9, #10)

## Proposed Solutions

### Option A: Remove Both (Recommended)
Delete `archiveCurrentVersion`, `enforceTokenBudget`, related settings, and imports.
- **Effort:** Small (~40 LOC removed) | **Risk:** Low

## Acceptance Criteria
- [ ] No filesystem archiving of generated AGENTS.md
- [ ] No token budget enforcement (per-category limit sufficient)
- [ ] Related settings removed from types

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Simplicity Reviewer |
