---
name: type_evolution
description: >
  Evolves the type system based on usage patterns. Runs as a cron job. Clusters
  unclassified "note" items, proposes new types or reclassifications. Respects
  approval settings — creates types with confirmed=true (auto) or confirmed=false (confirm).
allowed-tools:
  - search_items
  - get_item_by_id
  - get_entity_items
  - get_entity_profile
  - list_entities
  - get_agent_knowledge
  - get_dashboard
  - get_timeline
  - get_list_items
  - create_item
  - create_item_type
---

# type_evolution

## Trigger
Cron: settings.type_evolution_cron (default "0 10 1 * *")

## Analysis
1. Fetch items where type='note' from last settings.type_evolution_lookback_days.
2. Cluster by embedding similarity.
3. For clusters >= settings.type_evolution_min_cluster_size:
   a. Check if an existing type could absorb them → propose reclassify.
   b. If no → draft a new type definition.

## New Type Proposal
Build a complete item_types row: name, description, extraction_hint,
metadata_schema, behavioral flags, dashboard_section, icon.

### If settings.approval_new_type = 'auto':
- Insert with confirmed=true.
- Reclassify matching items if approval_reclassify = 'auto'.
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
