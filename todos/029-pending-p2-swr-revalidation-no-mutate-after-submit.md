---
status: complete
priority: p2
issue_id: "029"
tags: [code-review, ux, performance]
dependencies: ["026"]
---

# Problem Statement
`useEddaThreads` uses SWR with default options, meaning:
1. `revalidateOnFocus: true` (default) — every tab switch fires a `GET /api/threads` request, spamming the server
2. Thread list is never refreshed after a conversation completes — new/updated threads don't appear until user manually refocuses the tab
3. `onErrorRetry` 404 guard is unreachable: the fetcher throws `new Error(...)` not a response object, so `(error as { status?: number }).status === 404` is always `undefined`

# Findings
Flagged by: performance-oracle, code-simplicity-reviewer

- `apps/web/src/app/hooks/useEddaThreads.ts` lines 32–43: missing SWR config options
- `apps/web/src/app/hooks/useEddaThreads.ts` lines 37–42: dead `onErrorRetry` 404 guard
- No `mutate()` call after `useEdda.submit()` completes to refresh the thread list

# Proposed Solutions

```typescript
// useEddaThreads.ts
const { data, error, isLoading, mutate } = useSWR<ThreadItem[]>(
  SERVER_URL ? `${SERVER_URL}/api/threads` : null,
  fetcher,
  {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
    errorRetryCount: 3,
    // Remove onErrorRetry — 404 already handled in fetcher
  }
);
```

Wire up `mutate` from `useEddaThreads` into `ChatProvider` so it gets called when the stream ends:
```typescript
// In useEdda submit(), after finally:
onStreamEnd?.(); // callback that calls mutateThreads()
```

Or expose `mutate` from `useEddaThreads` and call it in `ChatProvider` after `submit` resolves.

# Technical Details
- `apps/web/src/app/hooks/useEddaThreads.ts`
- `apps/web/src/providers/ChatProvider.tsx` (needs to wire mutate after submit)
- Depends on 026 (thread endpoints need to exist for mutate to be meaningful)

# Acceptance Criteria
- [ ] `revalidateOnFocus: false` set in SWR config
- [ ] `onErrorRetry` dead code removed
- [ ] Thread list refreshes after a conversation completes
- [ ] No request spam on tab switching

# Work Log
- 2026-02-20: Created from performance-oracle review of 4A+4B chat port PR
