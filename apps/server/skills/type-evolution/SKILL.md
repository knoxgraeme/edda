---
name: type-evolution
description: >
  Evolves the type system based on usage patterns. Runs as a cron job. Clusters
  unclassified "note" items, proposes new types or reclassifications. Respects
  approval settings — creates types with confirmed=true (auto) or confirmed=false (confirm).
allowed-tools:
  - search_items
  - get_item_by_id
  - list_entity_items
  - get_entity_profile
  - list_entities
  - list_item_types
  - get_daily_summary
  - get_timeline
  - get_list_contents
  - create_item
  - create_item_type
---

# type-evolution

## Trigger
Cron: configured via agent_schedules (default "0 10 1 * *")

## Analysis
1. Call `list_item_types` to get current types.
2. Fetch items where type='note' from the last 30 days.
3. Cluster by embedding similarity.
4. For clusters >= 5 items:
   a. Check if an existing type could absorb them → propose reclassify.
   b. If no → draft a new type definition.

## New Type Proposal
Build a complete item_types row: name, description, classification_hint,
metadata_schema, icon.

### If settings.approval_new_type = 'auto':
- Insert with confirmed=true.
- Reclassify matching items if approval_new_type = 'auto'.
- On next chat: "I created a new type: 🍳 recipe (8 items matched)."

### If settings.approval_new_type = 'confirm':
- Insert with confirmed=false, pending_action="New type proposed by agent".
- On next chat: "I noticed 8 items that look like recipes. I've drafted a
  'recipe' type — it's on your dashboard for approval."

## Guard Rails
- Max 30 total types. Warn at 25.
- Never auto-delete a type.
- If two custom types overlap (>50% shared items), propose merge.
- Log all proposals to task_runs.
