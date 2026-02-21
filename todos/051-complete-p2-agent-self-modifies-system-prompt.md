---
status: complete
priority: p2
issue_id: "051"
tags: [code-review, security, architecture]
dependencies: []
---

# Agent Can Modify Own System Prompt + Bypass Approval Workflow

## Problem Statement
`AGENT_MUTABLE_KEYS` includes `system_prompt_override`, allowing the LLM agent to modify its own system prompt — a prompt injection persistence vector. Additionally, `update_item` exposes `confirmed` and `pending_action` fields, letting the agent bypass the approval workflow by directly confirming pending items.

## Findings
- **update-settings.ts lines 13-28:** `system_prompt_override` in `AGENT_MUTABLE_KEYS`
- **update-item.ts lines 19, 42:** `confirmed: z.boolean().optional()`, `pending_action` exposed
- If attacker gets LLM to call `update_settings` with malicious prompt, all future conversations affected
- Agent can silently confirm items, bypassing `confirm_pending`/`reject_pending` workflow
- **AGENTS.md is not a LangGraph convention** — Edda manually reads it from disk and injects into the system prompt. The file-based roundtrip (generate-agents-md.ts writes, system.ts reads) could be replaced with direct DB queries in the prompt builder.
- Agent: Security Sentinel (F5, F8)

## Proposed Solutions

### Option A: Structured Prompt Personalization via Skills (Recommended)

Replace the raw `system_prompt_override` with a structured, guardrailed approach:

1. **Remove `system_prompt_override` from `AGENT_MUTABLE_KEYS`** — agent cannot write raw prompt text
2. **Remove `confirmed` and `pending_action` from `updateItemSchema`** — confirmation only through dedicated tools
3. **Immutable base prompt** — core instructions in `prompts/system.ts` are never agent-writable
4. **Structured injection section** — add a `## User Preferences` section to the system prompt, generated from confirmed `preference`, `learned_fact`, `pattern` items in the DB (already queryable via `getAgentKnowledge`)
5. **`memory_extraction` skill** (already scaffolded) runs as after-agent hook or cron:
   - Extracts user preferences from conversations (e.g. "be more concise", "I prefer bullet points")
   - Stores them as discrete items with `type: 'preference'`
   - Items flow through the normal approval workflow (`confirmed = false` → user confirms)
   - Skill has guardrails on what kinds of preferences can be extracted
6. **Skip the AGENTS.md file roundtrip** — build the "About This User" section directly from DB queries in `buildSystemPrompt()` instead of writing to a file and reading it back. Keep the file for debugging if desired, but don't depend on it for prompt building.

**Benefits:**
- Agent never writes raw prompt text
- Each preference is a discrete, reviewable, deletable item
- Approval workflow applies to personality changes
- No prompt injection persistence vector
- Preferences are structured data, not an opaque string blob
- **Effort:** Medium | **Risk:** Low

### Option B: Remove system_prompt_override Entirely (Quick Fix)
Just remove from `AGENT_MUTABLE_KEYS` and strip `confirmed`/`pending_action` from `updateItemSchema`. Defer the structured approach.
- **Effort:** Small | **Risk:** Low

## Recommended Action
Option A — implement as part of the `memory_extraction` skill work. Option B as an interim fix.

## Technical Details
- **Affected files:** `apps/server/src/agent/tools/update-settings.ts`, `apps/server/src/agent/tools/update-item.ts`, `apps/server/src/agent/prompts/system.ts`, `apps/server/src/agent/generate-agents-md.ts`
- **Related skill:** `apps/server/skills/memory_extraction/SKILL.md`
- **Existing query:** `getAgentKnowledge()` in `packages/db/src/items.ts` already fetches preference/pattern/learned_fact items

## Acceptance Criteria
- [ ] `system_prompt_override` removed from `AGENT_MUTABLE_KEYS`
- [ ] `confirmed` and `pending_action` removed from `updateItemSchema`
- [ ] System prompt has structured "User Preferences" section built from DB items
- [ ] `memory_extraction` skill extracts preferences as discrete items
- [ ] Preferences flow through approval workflow before affecting prompt
- [ ] Agent cannot persist raw prompt text changes

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Security Sentinel |
| 2026-02-20 | Updated | Revised to structured skill-based approach per discussion. AGENTS.md is not a LangGraph convention — Edda manually reads/injects it. Prefer building prompt sections directly from DB queries. |

## Resources
- PR #1
- `apps/server/skills/memory_extraction/SKILL.md` — already scaffolded
- `packages/db/src/items.ts` — `getAgentKnowledge()` query
