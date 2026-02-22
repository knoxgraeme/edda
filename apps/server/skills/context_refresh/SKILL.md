---
name: context_refresh
description: >
  Maintains the AGENTS.md user context document. Runs daily via cron. A subagent
  compares the current AGENTS.md against fresh data from the database, makes
  surgical edits to reflect changes, and saves a new version. Prevents prompt
  bloat through curation and token budgeting.
---

# context_refresh

## Trigger
Cron: settings.context_refresh_cron (default "0 5 * * *")

## Architecture

AGENTS.md is stored in the `agents_md_versions` table (not on disk). Each edit
creates a new version row. The system prompt reads the latest version directly
from Postgres.

### Data flow
1. **Deterministic template** built from DB queries (preferences, facts, patterns,
   entities, item types, recent items, settings) — fast, free
2. **Diff computed** between previous template and current template
3. **Subagent receives**: current AGENTS.md + diff + raw materials
4. **Subagent makes surgical edits** — preserves stable content, adds new, drops removed
5. **Subagent saves** new version via `save_agents_md` tool

### Change detection
A SHA-256 hash of the deterministic template is stored with each version.
If the hash hasn't changed since the last run, the cron is a no-op.

## Subagent Tool Scoping
- **Tool**: save_agents_md (writes new version to agents_md_versions)
- **Read data**: provided via prompt (deterministic template + diff from DB queries), not via tools
- **Cannot**: create_item, update_item, delete_item — cannot modify user data

## What Goes In AGENTS.md
- **Identity** — who the user is (from learned_facts)
- **Directives** — imperative rules from preferences + patterns
- **Key entities** — top people, projects, companies with descriptions
- **Item types** — available types with classification hints and metadata schemas
- **Active context** — what the user is currently working on
- **Boundaries** — privacy rules, confirmation settings
- **Recall guide** — which tools to use for deeper context

## Cost
Uses settings.context_refresh_model (default: same as memory_extraction_model).
Typical cost: ~$0.01-0.05/day. No-op when nothing has changed.
