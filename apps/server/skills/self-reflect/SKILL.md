---
name: self-reflect
description: >
  Cross-session self-improvement. Reviews session notes from recent conversations,
  identifies recurring corrections, preferences, and quality signals, then updates
  AGENTS.md procedural memory with synthesized insights. Runs per-agent on schedule.
allowed-tools:
  - search_items
  - get_item_by_id
  - get_agents_md
  - save_agents_md
  - update_agent
  - list_agents
---

# self-reflect

## Trigger
Cron: configured via agent_schedules (default "0 3 * * 0", ephemeral thread)

The cron runner performs a pre-check before invoking this skill: if no new
`session_note` items exist since the last successful run, the invocation is
skipped entirely (zero LLM cost).

---

## Workflow

### 1. Search for recent session notes

```
search_items({ query: "session note", type: "session_note", limit: 50 })
```
Filter to items since your last self-reflect run.

### 2. Analyze across all notes

Look for recurring themes:

**Corrections** — What did the user correct me on?
- Same correction appearing in multiple notes = high-priority fix
- Single correction = still worth noting, but lower confidence
- Group by theme: formatting, tone, scope, accuracy, behavior

**Preferences** — How does the user prefer to receive information?
- Consistent formatting preferences (bullets vs prose, length, detail level)
- Communication style (formal vs casual, verbose vs terse)
- Workflow preferences (when to ask vs when to act)

**Quality signals** — What went well or poorly?
- Positive signals: user moved on quickly, said thanks, reused output
- Negative signals: user repeated request, corrected output, abandoned thread
- Look for what differentiates good interactions from bad ones

### 3. Read current AGENTS.md

```
get_agents_md()
```

### 4. Make surgical updates

Update AGENTS.md sections:
- **Communication**: Add/refine communication style observations
- **Patterns**: Add behavioral patterns observed across notes
- **Standards**: Add/refine quality expectations
- **Corrections**: Add new corrections, reinforce recurring ones

### 5. Save

```
save_agents_md({ content: "..." })
```

The tool automatically scopes the save to this agent via `getAgentName(config)`.

### 6. Optionally update agent prompt

Only if you see a clear task-level pattern across 3+ notes. For example:
- Agent consistently does something not in its instructions → add it
- Agent consistently skips a step that's in its instructions → remove/revise it
- Use `list_agents` to read current prompt, then `update_agent` to modify

---

## Rules

- **Don't rewrite stable sections** — only add/modify what recent data supports
- **Corrections are append-only** unless explicitly reversed by the user
  ("actually, go back to the old way")
- **Merge similar observations** into single clear statements. Three notes
  saying "summary too long" becomes one entry: "Summaries: 3 bullets max"
- **Stay within token budget** — prune outdated entries if needed
- **Agent prompt changes are conservative** — only when the pattern is clear
  across 3+ notes. Memory changes can be made on 2+ notes.
- **No new insights = no changes** — if session notes are empty or trivial,
  stop and note "No actionable patterns found"
- **Focus on synthesis, not transcription** — turn raw data into clear
  operating guidance

---

## What Goes Where

| Signal | Where | Example |
|---|---|---|
| Repeated correction about output format | Memory → Standards | "Summaries: 3 bullets max" |
| Communication style preference | Memory → Communication | "Prefers terse confirmations" |
| Behavioral pattern across notes | Memory → Patterns | "Batches admin tasks Mondays" |
| Specific mistake to avoid | Memory → Corrections | "Don't merge entities by first name" |
| Agent consistently does unlisted task | Agent prompt → Task | Add the step |
| Agent consistently skips a listed step | Agent prompt → Task | Remove/revise |
