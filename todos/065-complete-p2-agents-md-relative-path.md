---
status: complete
priority: p2
issue_id: "065"
tags: [code-review, correctness, agent-prompts]
dependencies: []
---

# AGENTS.md Loaded via Relative Path — CWD-Dependent

## Problem Statement
`buildSystemPrompt()` loads AGENTS.md via `readFile("./AGENTS.md", "utf-8")` which resolves relative to `process.cwd()`, not the source file. If the server starts from a different directory, it loads the wrong file or silently fails. The generator (`generate-agents-md.ts`) correctly uses `__dirname`-relative paths.

## Findings
- **Source**: security-sentinel, performance-oracle
- **File**: `apps/server/src/agent/prompts/system.ts` — `readFile("./AGENTS.md", ...)`
- **File**: `apps/server/src/agent/generate-agents-md.ts:20-22` — correctly uses `__dirname`-relative `AGENTS_MD_PATH`
- Inconsistency: generator writes to `__dirname`-resolved path, reader uses CWD-relative path

## Proposed Solutions

### Option A: Use __dirname-relative path (Recommended)
```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_MD_PATH = join(__dirname, "../../AGENTS.md");
```
Or import the constant from `generate-agents-md.ts`.
- Pros: Consistent with generator, works regardless of CWD
- Cons: None
- Effort: Very small
- Risk: None

## Acceptance Criteria
- [ ] AGENTS.md path is resolved relative to source file, not CWD
- [ ] Path is consistent with `generate-agents-md.ts`

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from agent factory review | |
| 2026-02-20 | Fixed | Addressed in agent factory review fixes commit |
## Resources
- `apps/server/src/agent/prompts/system.ts`
- `apps/server/src/agent/generate-agents-md.ts`
