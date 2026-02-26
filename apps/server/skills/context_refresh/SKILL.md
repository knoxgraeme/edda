---
name: context_refresh
description: >
  Maintains the AGENTS.md user context document. Checks for changes in user
  data (preferences, entities, item types, etc.) and makes surgical edits
  to keep the document current. Prevents prompt bloat through curation and
  token budgeting.
allowed-tools:
  - get_context_diff
  - save_agents_md
---

# context_refresh

## Workflow

1. **Call `get_context_diff`** to check for changes
2. If status is `no_changes` — respond "No context changes detected" and stop
3. If status is `changes_detected` — you receive:
   - `current_content`: the live AGENTS.md text
   - `diff`: what changed (+ added, - removed lines)
   - `raw_template`: full deterministic data snapshot
   - `token_budget`: max token count for the document
4. **Make surgical edits** to `current_content` based on the diff:
   - Add new information where it fits
   - Remove information that was deleted from the source data
   - Preserve stable content — don't rewrite sections that haven't changed
5. **Call `save_agents_md`** with your edited content

## Architecture

AGENTS.md is stored in the `agents_md_versions` table (not on disk). Each edit
creates a new version row. The system prompt reads the latest version directly
from Postgres.

## What Goes In AGENTS.md

- **Identity** — who the user is (from learned_facts)
- **Directives** — imperative rules from preferences + patterns
- **Key entities** — top people, projects, companies with descriptions
- **Item types** — available types with classification hints and metadata schemas
- **Active context** — what the user is currently working on
- **Boundaries** — privacy rules, confirmation settings
- **Recall guide** — which tools to use for deeper context

## Rules

- Stay within the token budget (~budget * 4 characters)
- Be a curator, not a transcriber — synthesize, don't dump raw data
- Preserve the user's voice when quoting preferences
- Drop stale information that no longer appears in the raw template
- On first run (empty current_content), create the document from scratch using the raw template
