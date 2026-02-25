---
name: weekly_reflect
description: >
  Weekly patterns, reflection, and memory maintenance. Runs as a cron job.
  Identifies themes, surfaces most active entities, detects dropped threads,
  consolidates duplicate memories, resolves contradictions, archives stale
  knowledge, and creates an insight item.
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
---

# weekly_reflect

## Trigger
Cron: settings.weekly_review_cron (default "0 18 * * 0")

## Behavior — Activity Analysis
1. Pull all items from the past 7 days.
2. Items by type, completion rate, busiest day.
3. Most mentioned entities.
4. Stale items (open > stale_item_days).
5. Dropped threads: entities active 2+ weeks ago, no recent mentions.
6. If new cross-conversation behavioral patterns detected, create items
   with type='pattern', source='cron'. This catches patterns that span
   multiple days and wouldn't be visible to the daily memory_catchup cron
   (e.g. "user tends to capture ideas on weekday evenings" requires a week of data).

## Behavior — Memory Maintenance

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

11. **Refresh AGENTS.md**: After maintenance, the cron runner will
    automatically refresh the agent context via hash-based change detection.

## Output
Create item: type='insight', source='cron'. Include a "memory maintenance"
section in the insight: "Merged X duplicates, archived Y stale memories,
resolved Z contradictions, refreshed W entity descriptions."
