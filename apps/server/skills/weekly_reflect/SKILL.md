---
name: weekly_reflect
description: >
  Weekly reflection, memory maintenance, and self-improvement. Runs as a cron job.
  Part 1: Activity analysis — themes, active entities, dropped threads, cross-session patterns.
  Part 2: Memory maintenance — dedup, archive stale, resolve contradictions, consolidate entities.
  Part 3: Self-improvement — analyze session summaries for corrections and quality signals,
  update AGENTS.md procedural memory with synthesized insights.
allowed-tools:
  - search_items
  - get_item_by_id
  - list_entity_items
  - get_entity_profile
  - list_entities
  - get_daily_summary
  - get_timeline
  - get_list_contents
  - create_item
  - batch_create_items
  - update_item
  - delete_item
  - upsert_entity
  - link_item_entity
  - list_unprocessed_threads
  - get_thread_messages
  - mark_thread_processed
  - list_threads
  - get_context_diff
  - save_agents_md
  - update_agent
  - list_agents
---

# weekly_reflect

## Trigger
Cron: settings.weekly_review_cron (default "0 18 * * 0")

---

## Part 1 — Activity Analysis

1. Pull all items from the past 7 days.
2. Items by type, completion rate, busiest day.
3. Most mentioned entities.
4. Stale items (open > stale_item_days).
5. Dropped threads: entities active 2+ weeks ago, no recent mentions.
6. If new cross-conversation behavioral patterns detected, create items
   with type='pattern', source='cron'. This catches patterns that span
   multiple days and wouldn't be visible to the daily memory_catchup cron
   (e.g. "user tends to capture ideas on weekday evenings" requires a week of data).

---

## Part 2 — Memory Maintenance

This is NOT just about adding new insights — cleaning up existing knowledge
is equally important. Perform the following maintenance steps:

7. **Merge near-duplicate memories**: For each agent-internal type (preference,
   learned_fact, pattern), search for items with cosine similarity > 0.8. For
   each cluster of near-duplicates, synthesize into a single richer item that
   captures the best phrasing. Archive the originals (status='archived').

8. **Archive stale memories**: Agent-internal items where
   COALESCE(last_reinforced_at, updated_at) is older than 90 days. Archive them —
   they're still in the DB but won't appear in AGENTS.md. If a stale memory is
   later re-extracted, it will be created fresh.

9. **Resolve contradictions**: Compare active learned_fact items. If two
   contradict (e.g. "User works at Acme" vs. "User works at NewCo"), keep the
   most recent (by updated_at), set superseded_by on the older one, archive it.

10. **Consolidate entity descriptions**: For entities with 10+ linked items,
    regenerate a clean description from recent linked item content.

---

## Part 3 — Self-Improvement (from session summaries)

After activity analysis and memory maintenance, review session summaries from the
past week to identify behavioral trends and update AGENTS.md procedural memory.

This is the primary mechanism for long-term agent improvement. Corrections and
quality signals from session summaries are the highest-value input.

### Workflow

11. **Search for recent session summaries:**
    ```
    search_items({ query: "session summary", type: "session_summary", limit: 50 })
    ```
    Filter to items from the past 7 days.

12. **Analyze across all summaries** — look for recurring themes:

    **Corrections** — What did the user correct me on?
    - Same correction appearing in multiple summaries = high-priority fix
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

13. **Read current AGENTS.md** via `get_context_diff`

14. **Make surgical updates** to AGENTS.md sections:
    - **Communication**: Add/refine communication style observations
    - **Patterns**: Add behavioral patterns observed across summaries
    - **Standards**: Add/refine quality expectations
    - **Corrections**: Add new corrections, reinforce recurring ones

15. **Save** via `save_agents_md`

16. **Optionally update agent prompt** — Only if you see a clear task-level
    pattern across 3+ summaries. For example:
    - Agent consistently does something not in its instructions → add it
    - Agent consistently skips a step that's in its instructions → remove/revise it
    - Use `list_agents` to read current prompt, then `update_agent` to modify

### Self-Improvement Rules

- **Don't rewrite stable sections** — only add/modify what this week's data supports
- **Corrections are append-only** unless explicitly reversed by the user
  ("actually, go back to the old way")
- **Merge similar observations** into single clear statements. Three summaries
  saying "summary too long" becomes one entry: "Summaries: 3 bullets max"
- **Stay within token budget** — prune outdated entries if needed
- **Agent prompt changes are conservative** — only when the pattern is clear
  across 3+ summaries. Memory changes can be made on 2+ summaries.
- **No new insights = no changes** — if session summaries are empty or trivial,
  skip Part 3 and note "No actionable patterns found this week"
- **Focus on synthesis, not transcription** — turn raw data into clear
  operating guidance

### What Goes Where

| Signal | Where | Example |
|---|---|---|
| Repeated correction about output format | Memory → Standards | "Summaries: 3 bullets max" |
| Communication style preference | Memory → Communication | "Prefers terse confirmations" |
| Behavioral pattern across summaries | Memory → Patterns | "Batches admin tasks Mondays" |
| Specific mistake to avoid | Memory → Corrections | "Don't merge entities by first name" |
| Agent consistently does unlisted task | Agent prompt → Task | Add the step |
| Agent consistently skips a listed step | Agent prompt → Task | Remove/revise |

---

## Output

Create item: type='insight', source='cron'. Include all three parts in the output:

**Activity analysis**: Items by type, completion rate, busiest day, most active entities.

**Memory maintenance**: "Merged X duplicates, archived Y stale memories,
resolved Z contradictions, refreshed W entity descriptions."

**Self-improvement**: List any AGENTS.md changes made and why, or note
"No actionable patterns found this week" if session summaries were empty/trivial.
