---
status: pending
priority: p2
issue_id: "035"
tags: [code-review, correctness, agent-tools]
dependencies: []
---

# create_item_type Schema Declares 4 Fields Handler Ignores

## Problem Statement
The `create_item_type` tool schema declares `dashboard_section`, `completable`, `has_due_date`, and `is_list` fields, but the handler only destructures `{ name, description, extraction_hint, metadata_schema, icon }`. The LLM can set these fields and believe they took effect, but they are silently dropped.

## Findings
- **Source**: kieran-typescript-reviewer, code-simplicity-reviewer, agent-native-reviewer
- **File**: `apps/server/src/agent/tools/create-item-type.ts:14-21` — 4 schema fields
- **File**: `apps/server/src/agent/tools/create-item-type.ts:25` — handler destructures only 5 fields
- The DB function `createItemType` does not accept these fields either

## Proposed Solutions

### Option A: Remove unused fields from schema (Recommended for now)
Remove `dashboard_section`, `completable`, `has_due_date`, `is_list` from the Zod schema until the DB function supports them.
- Pros: Honest API, no silent data loss
- Cons: Agent loses the ability to set these (but they didn't work anyway)
- Effort: Very small
- Risk: Low

### Option B: Wire fields through to DB
Update `createItemType` DB function to accept and store these fields.
- Pros: Full functionality
- Cons: Requires DB function changes, may need migration for column defaults
- Effort: Medium
- Risk: Low

## Acceptance Criteria
- [ ] No Zod schema fields that the handler ignores
- [ ] Either fields are wired through or removed

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from Phase 2 tools review | All 3 review agents flagged this |

## Resources
- PR commit: 960f19d
