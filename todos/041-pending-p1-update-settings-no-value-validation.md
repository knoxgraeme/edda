---
status: pending
priority: p1
issue_id: "041"
tags: [code-review, security, typescript]
dependencies: []
---

# update_settings Accepts z.record(z.unknown()) — No Value Type Validation

## Problem Statement
The `update_settings` tool validates keys via `AGENT_MUTABLE_KEYS` allowlist, but values are entirely unvalidated (`z.record(z.unknown())`). The agent could pass `{ user_timezone: 42 }` or `{ web_search_enabled: "banana" }`, silently writing bad data to the settings table that powers the entire system.

## Findings
- **File:** `apps/server/src/agent/tools/update-settings.ts` line 31
- Schema: `updates: z.record(z.unknown())` — accepts any value for any key
- Settings control LLM selection, cron behavior, approval modes — bad values cause silent failures
- Agent: TypeScript Reviewer (#2), Security Sentinel (implicit)

## Proposed Solutions

### Option A: Typed Zod Object Schema (Recommended)
Replace `z.record(z.unknown())` with explicit per-key validation.
```typescript
updates: z.object({
  user_display_name: z.string().nullish(),
  user_timezone: z.string().optional(),
  web_search_enabled: z.boolean().optional(),
  approval_new_type: z.enum(["auto", "confirm"]).optional(),
  // ... each mutable key with proper type
}).partial()
```
- **Pros:** Full type safety, LLM gets schema guidance
- **Effort:** Small
- **Risk:** Low

### Option B: Runtime Type Check Map
Keep `z.record()` but validate values at runtime against a type map.
- **Pros:** Less schema duplication
- **Effort:** Small
- **Risk:** Medium — type map could drift

## Technical Details
- **Affected files:** `apps/server/src/agent/tools/update-settings.ts`

## Acceptance Criteria
- [ ] Each mutable setting key has proper Zod type validation
- [ ] Passing wrong value types returns a validation error
- [ ] Schema provides type hints to the LLM

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by TypeScript Reviewer |

## Resources
- PR #1
