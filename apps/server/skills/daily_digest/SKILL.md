---
name: daily_digest
description: >
  Auto-generated morning briefing. Runs as a cron job. Summarizes yesterday,
  surfaces today's due items, flags stale open items. Creates a daily_digest item.
---

# daily_digest

## Trigger
Cron: settings.daily_digest_cron (default "0 7 * * *")

## Behavior
1. Get yesterday's items (captured, completed).
2. Get today's due items.
3. Get upcoming (next 3 days).
4. Count open items + stale items (age > settings.stale_item_days).
5. Get active list summaries.
6. Create item: type='daily_digest', source='cron'.
