---
status: pending
priority: p3
issue_id: "013"
tags: [code-review, quality]
dependencies: []
---

# Problem Statement
The session-context.sh hook script looks for skills in `apps/server/src/skills/` but actual SKILL.md files are in `apps/server/skills/` (outside src/). This causes session context to report "(no skills directory)" on startup, hiding useful skill information from the agent context.

# Findings
At line 52 of the session context script, the path is set to look inside `src/` for the skills directory. The actual skill definitions (SKILL.md files) live one level up at `apps/server/skills/`.

- `.claude/hooks/scripts/session-context.sh` (line 52) — incorrect path `apps/server/src/skills/`
- `apps/server/skills/` — actual location of SKILL.md files

# Proposed Solutions
## Option A: Fix the skills directory path
- Change path from `apps/server/src/skills` to `apps/server/skills` in session-context.sh
- Effort: Small

# Technical Details
- Affected files: `.claude/hooks/scripts/session-context.sh`

# Acceptance Criteria
- [ ] Session context correctly lists skill files on startup
- [ ] Path in session-context.sh points to `apps/server/skills/`
