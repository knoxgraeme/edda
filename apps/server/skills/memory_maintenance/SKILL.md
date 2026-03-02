---
name: memory_maintenance
description: >
  Database housekeeping for the memory system. Merges near-duplicate memories,
  archives stale items, resolves contradictions, and consolidates entity
  descriptions. Runs as a cron job on the maintenance agent.
allowed-tools:
  - search_items
  - get_item_by_id
  - list_entity_items
  - get_entity_profile
  - list_entities
  - create_item
  - update_item
  - delete_item
  - upsert_entity
  - link_item_entity
---

# memory_maintenance

## Trigger
Cron: configured via agent_schedules (default "0 4 * * 0")

---

## Workflow

This is NOT just about adding new insights — cleaning up existing knowledge
is equally important. Perform the following maintenance steps:

### 1. Merge near-duplicate memories

For each agent-internal type (preference, learned_fact, pattern), search for
items with cosine similarity > 0.8. For each cluster of near-duplicates,
synthesize into a single richer item that captures the best phrasing.
Archive the originals (status='archived').

### 2. Archive stale memories

Agent-internal items where COALESCE(last_reinforced_at, updated_at) is older
than 90 days. Archive them — they're still in the DB but won't clutter active
results. If a stale memory is later re-extracted, it will be created fresh.

### 3. Resolve contradictions

Compare active learned_fact items. If two contradict (e.g. "User works at Acme"
vs. "User works at NewCo"), keep the most recent (by updated_at), set
superseded_by on the older one, archive it.

### 4. Consolidate entity descriptions

For entities with 10+ linked items, regenerate a clean description from recent
linked item content.

---

## Output

Create item: type='insight', source='cron'. Include:

**Memory maintenance**: "Merged X duplicates, archived Y stale memories,
resolved Z contradictions, refreshed W entity descriptions."
