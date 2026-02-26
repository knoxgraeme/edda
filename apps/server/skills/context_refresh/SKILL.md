---
name: context_refresh
description: >
  Checks for new user data (preferences, facts, patterns, entities) and
  incorporates relevant changes into the AGENTS.md procedural memory.
  Runs on a schedule to keep the agent's operating notes current with
  recently learned information.
allowed-tools:
  - get_context_diff
  - save_agents_md
---

# context_refresh

## Purpose

AGENTS.md is your procedural memory — operating notes about how to serve this
user. This skill detects when new raw data (preferences, facts, patterns,
entities) has been added to the database and helps you decide if any of it
should be reflected in your operating notes.

## Workflow

1. **Call `get_context_diff`** to check for changes
2. If status is `no_changes` — respond "No context changes detected" and stop
3. If status is `changes_detected` — you receive:
   - `current_content`: the live AGENTS.md text
   - `diff`: what changed in raw data (+ added, - removed lines)
   - `raw_template`: full data snapshot (preferences, facts, patterns, entities)
   - `token_budget`: max token count for the document
4. **Review the diff** and decide what belongs in your operating notes:
   - New preference about communication style? → update **## Communication**
   - New behavioral pattern observed? → update **## Patterns**
   - New correction or feedback captured? → update **## Corrections**
   - New quality expectation? → update **## Standards**
   - Raw factual data (birthdays, job titles, etc.)? → skip, it's already searchable via items
5. **Call `save_agents_md`** with your edited content

## AGENTS.md Structure

```
## Communication
- {how the user prefers to receive information}
- {shorthand, tone preferences, format preferences}

## Patterns
- {recurring behaviors, rhythms, habits}
- {how the user typically works with the system}

## Standards
- {what "good output" looks like for this user}
- {quality expectations for summaries, tasks, captures}

## Corrections
- {specific things the user has told the agent to stop/start doing}
- {mistakes the agent made and should not repeat}
```

## What Belongs in AGENTS.md vs Items

- **AGENTS.md**: Operating notes that shape behavior — "user prefers bullets",
  "summaries should be 3 lines max", "don't merge entities with same first name"
- **Items DB**: Granular facts searchable via tools — "user likes Thai food",
  "Tom's birthday is March 15", "user works at Acme Corp"

If a new preference is about HOW you should behave, add it to AGENTS.md.
If it's WHAT the user knows/likes/has, it's already in items — skip it.

## Rules

- Stay within the token budget (~budget * 4 characters)
- Synthesize, don't dump — turn raw data into clear operating guidance
- Preserve stable content — don't rewrite sections that haven't changed
- Merge similar entries into single clear statements
- On first run (empty current_content), create the document from scratch
  using the starter template above
