---
name: weekly_report
description: >
  Weekly activity analysis and reporting. Runs as a cron job on the digest agent.
  Analyzes items by type, completion rates, active entities, stale items,
  dropped threads, and cross-session patterns.
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
  - list_threads
---

# weekly_report

## Trigger
Cron: configured via agent_schedules (default "0 18 * * 0")

---

## Workflow

1. Pull all items from the past 7 days.
2. Items by type, completion rate, busiest day.
3. Most mentioned entities.
4. Stale items (open > 30 days).
5. Dropped threads: entities active 2+ weeks ago, no recent mentions.
6. If new cross-conversation behavioral patterns detected, create items
   with type='pattern', source='cron'. This catches patterns that span
   multiple days and wouldn't be visible to daily extraction
   (e.g. "user tends to capture ideas on weekday evenings" requires a week of data).

---

## Output

Create item: type='insight', source='cron'. Include:

**Activity analysis**: Items by type, completion rate, busiest day, most active entities.
Stale items flagged. Dropped threads noted.
