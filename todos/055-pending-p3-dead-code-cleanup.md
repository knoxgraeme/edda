---
status: pending
priority: p3
issue_id: "055"
tags: [code-review, simplicity]
dependencies: ["050"]
---

# Dead Code Cleanup — Aliases, Dummy Schemas, Unused Functions

## Problem Statement
Several pieces of dead code exist: a fake backwards-compat `getEmbeddings()` alias (no backwards to be compat with in PR #1), a dummy `eddaToolsSchema` in tools/index.ts to satisfy an over-broad hook check, unused DB functions (`updateEntity`, `searchEntities`, `getEntitiesByName` not called by any tool), and duplicate `generate-type-reference.ts` / `generate-types-md.ts` files.

## Findings
- **embed/index.ts:48-51:** `getEmbeddings()` — pure alias of `getCachedEmbeddings()` with "backwards compatibility" comment on first PR
- **tools/index.ts:8-11:** Dummy `eddaToolsSchema = z.object({})` — workaround for hook checking all *.ts in tools/
- **entities.ts:** `updateEntity`, `searchEntities`, `getEntitiesByName` — no tool callers
- **generate-type-reference.ts vs generate-types-md.ts:** Both generate markdown from item types, new file is better but old still exists
- Agent: Simplicity Reviewer (#4, #7, #13, #14, #16)

## Proposed Solutions

### Option A: Clean Up (Recommended)
1. Remove `getEmbeddings()` alias
2. Update `post-edit-checks.sh` to skip `index.ts`, remove dummy schema
3. Remove old `generate-types-md.ts` if `generate-type-reference.ts` replaces it
4. Keep unused entity DB functions (needed by future skills) but add TODO comments
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] No fake backwards-compat aliases
- [ ] Hook script excludes index.ts from schema check
- [ ] No duplicate file generation scripts

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Simplicity Reviewer |
