---
status: pending
priority: p2
issue_id: "064"
tags: [code-review, security, typescript, plan-1i]
dependencies: []
---

# Message Schema Too Permissive — Allows Non-Human Types and Unbounded Content

## Problem Statement
The Zod schema accepts `type: "ai" | "tool" | "system"` from clients, letting them inject fake system/AI messages. Content uses `z.array(z.unknown())` which accepts deeply nested arbitrary data. No content length limit within the 1MB body.

## Findings
- Plan lines 94-101: `type: z.enum(["human", "ai", "tool", "system"])`, `content: z.union([z.string(), z.array(z.unknown())])`
- `useEdda.ts` only ever sends `type: "human"` (line 44-48) — so restricting to "human" is safe
- Agent: Security Sentinel (P2-03), TypeScript Reviewer (P1-2)

## Proposed Solutions

### Option A: Restrict to human messages only (Recommended)
```typescript
const StreamRequestSchema = z.object({
  messages: z.array(z.object({
    id: z.string().uuid(),
    type: z.literal("human"),
    content: z.string().max(32_000),
  })).min(1).max(1),
  thread_id: z.string().uuid(),
});
```
- **Effort:** Small | **Risk:** Low

### Option B: Validate contract only, defer to LangGraph (Simplicity approach)
```typescript
const StreamRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1),
  thread_id: z.string().uuid(),
});
```
- **Effort:** Small | **Risk:** Medium (no content validation)

## Acceptance Criteria
- [ ] Client cannot inject non-human message types
- [ ] Content has a reasonable size limit
- [ ] Schema matches what `useEdda.ts` actually sends
