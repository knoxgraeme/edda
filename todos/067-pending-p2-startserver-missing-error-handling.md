---
status: pending
priority: p2
issue_id: "067"
tags: [code-review, typescript, plan-1i]
dependencies: []
---

# startServer Missing Port Error and Shutdown Issues

## Problem Statement
Multiple issues with the server lifecycle:
1. `app.listen()` does not have an error handler — if port is in use, the promise hangs forever
2. Dynamic `import("@edda/db")` in shutdown handler is fragile — if resolution fails, `closePool` never runs
3. `server.close()` is not awaited — `process.exit(0)` fires before connections drain

## Findings
- Plan lines 186-198: `startServer` implementation
- No `server.on("error", reject)` for port conflicts
- `closePool` imported dynamically inside SIGTERM handler
- `server.close()` is async but not awaited
- Agent: TypeScript Reviewer (P2-3, P2-4), Security Sentinel (P3-02)

## Proposed Solutions

### Option A: Fix all three (Recommended)
```typescript
import { closePool } from "@edda/db"; // static import

export async function startServer(agent: DeepAgent, port: number): Promise<void> {
  const app = createServer(agent);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve());
    server.on("error", reject);

    const shutdown = async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await closePool();
      process.exit(0);
    };
    const forceExit = () => { console.error("Forced shutdown"); process.exit(1); };
    process.on("SIGTERM", () => { shutdown(); setTimeout(forceExit, 10_000); });
    process.on("SIGINT", () => { shutdown(); setTimeout(forceExit, 10_000); });
  });
}
```
- **Effort:** Small | **Risk:** Low

## Acceptance Criteria
- [ ] Port-in-use error rejects the promise cleanly
- [ ] `closePool` is a static import
- [ ] `server.close()` is awaited before `closePool()`
- [ ] Force shutdown timeout prevents hanging on SIGTERM
