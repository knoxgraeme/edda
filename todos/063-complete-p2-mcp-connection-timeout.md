---
status: complete
priority: p2
issue_id: "063"
tags: [code-review, reliability, performance, mcp]
dependencies: []
---

# No MCP Connection Timeout — Slow Server Blocks Startup Indefinitely

## Problem Statement
`loadToolsFromConnection()` calls `client.connect(transport)` and `client.listTools()` with no timeout. `Promise.allSettled` isolates failures but only resolves after all promises settle. A single unresponsive MCP server (hung stdio process, unreachable SSE endpoint) causes the entire startup to hang indefinitely.

## Findings
- **Source**: performance-oracle
- **File**: `apps/server/src/agent/mcp.ts:112` — `await client.connect(transport)` with no timeout
- **File**: `apps/server/src/agent/mcp.ts:115` — `await client.listTools()` with no timeout
- A single bad entry in `mcp_connections` table turns sub-second startup into indefinite hang
- Common in production: MCP servers go down, containers restart, stdio processes deadlock

## Proposed Solutions

### Option A: Add withTimeout wrapper (Recommended)
Wrap both `connect` and `listTools` with a configurable timeout (default 10s).
```typescript
const CONNECTION_TIMEOUT_MS = parseInt(process.env.MCP_TIMEOUT_MS ?? "10000", 10);

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
```
- Pros: Bounded startup time, configurable, per-connection granularity
- Cons: Timed-out connections silently excluded (but logged via allSettled handler)
- Effort: Small
- Risk: Low

## Acceptance Criteria
- [ ] `client.connect()` and `client.listTools()` have timeout guards
- [ ] Timeout is configurable via env var
- [ ] Timed-out connections are logged and skipped, not fatal

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | performance-oracle flagged |
| 2026-02-20 | Fixed | Addressed in agent factory review fixes commit |
## Resources
- `apps/server/src/agent/mcp.ts`
