---
name: memory_sync
description: >
  Synthesizes memory files for entities above the activity threshold. Runs as a
  cron job. For each qualifying entity (person, project, company), gathers linked
  items, synthesizes a concise brief, and writes it to the /memories/ store via
  create_memory_file.
---

# memory_sync

## Trigger
Cron: settings.memory_sync_cron (default "0 5 * * *")

## Behavior
1. Load memory types from DB (people, projects, organizations).
2. For each memory type, find entities above activity threshold
   (settings.memory_file_activity_threshold, default 10 linked items).
3. For each qualifying entity:
   a. Gather linked items via get_entity_items.
   b. Synthesize a concise brief: who/what they are, relationship to user,
      key facts, recent activity.
   c. Write to store via create_memory_file with source='cron'.
   d. Path format: /people/{slug}, /projects/{slug}, /organizations/{slug}.
4. After all writes, context_refresh cron updates AGENTS.md with new memory file pointers.

## Brief Format
- Under 2000 characters
- Markdown with sections: identity, relationship, key facts, recent activity
- Written in third person
- Always regenerated from source items (ignore existing memory file content)

## Cost
Uses settings.memory_sync_model. One agent invocation with tool calls per entity.
Typical cost depends on entity count and linked item volume.
