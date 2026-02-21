---
status: pending
priority: p3
issue_id: "015"
tags: [code-review, quality]
dependencies: []
---

# Problem Statement
Two different defaults for PORT exist in the server — config.ts defaults to 8000 while index.ts has a fallback of 3001. Whichever runs first wins, creating confusion about which port the server actually listens on.

# Findings
The server has two competing PORT defaults in different files. This can lead to unexpected behavior depending on code path and whether the config module is loaded before the entry point fallback is evaluated.

- `apps/server/src/config.ts` — PORT default is 8000
- `apps/server/src/index.ts` — PORT fallback is 3001

# Proposed Solutions
## Option A: Align to single PORT default via config.ts
- Update index.ts to use `loadConfig().PORT` instead of its own `process.env.PORT || 3001` fallback
- Keep 8000 as the canonical default in config.ts
- Effort: Small

# Technical Details
- Affected files:
  - `apps/server/src/config.ts`
  - `apps/server/src/index.ts`

# Acceptance Criteria
- [ ] Single source of truth for PORT default (config.ts with 8000)
- [ ] index.ts uses loadConfig().PORT instead of a separate fallback
