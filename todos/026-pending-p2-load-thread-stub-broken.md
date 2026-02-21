---
status: complete
priority: p2
issue_id: "026"
tags: [code-review, correctness, ux]
dependencies: []
---

# Problem Statement
`loadThread` in `useEdda.ts` sets the thread ID and clears the message list but never fetches historical messages from the server. Clicking a thread in the sidebar shows a blank chat. There is also no `GET /api/threads/:id/messages` endpoint on the server. Thread switching is entirely non-functional.

Additionally `GET /api/threads` returns a 404 (only `/api/health` exists on the server), so the thread list sidebar is always empty — users cannot see past conversations at all.

# Findings
Flagged by: kieran-typescript-reviewer, agent-native-reviewer (Critical)

- `apps/web/src/app/hooks/useEdda.ts` lines 158–162: `loadThread` clears messages, `// TODO` comment
- `apps/server/src/index.ts` (health endpoint only) — no `/api/threads` or `/api/threads/:id/messages`
- `apps/web/src/app/hooks/useEddaThreads.ts` — returns `[]` gracefully on 404, masking the missing endpoint

This is partially a 1I (custom streaming server) task dependency, but the UI should not export a broken function silently.

# Proposed Solutions

## Option A: Implement GET /api/threads + GET /api/threads/:id/messages (full fix)
As part of task 1I (custom streaming server), add:
- `GET /api/threads` — query `threads` table, return `{ id, title, updatedAt }[]`
- `GET /api/threads/:id/messages` — read from LangGraph checkpointer for the given `thread_id`
Update `loadThread` to call the messages endpoint and populate state.

## Option B: Guard the UI until endpoint exists
Until 1I is complete, remove `loadThread` from the `useEdda` return value (or throw clearly), and hide the ThreadList component behind a feature flag / conditional. Prevents silent UX confusion.

**Recommended: Option B immediately, Option A when 1I is worked.**

# Technical Details
- `apps/web/src/app/hooks/useEdda.ts`
- `apps/server/src/index.ts` (or new `apps/server/src/server.ts` from task 1I)
- Relates to work breakdown task 1I (custom streaming server)

# Acceptance Criteria
- [ ] Selecting a thread from ThreadList loads its messages
- [ ] `GET /api/threads` returns thread list from DB
- [ ] `GET /api/threads/:id/messages` returns message history from checkpointer
- [ ] No exported hooks that silently no-op on user actions

# Work Log
- 2026-02-20: Created from TypeScript + agent-native review of 4A+4B chat port PR
