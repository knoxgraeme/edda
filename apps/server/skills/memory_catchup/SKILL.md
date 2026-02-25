---
name: memory_catchup
description: >
  Nightly catch-up extraction. Reviews conversation threads where the afterAgent
  hook didn't fire (tab close, crash, Ctrl+C) and extracts missed implicit
  knowledge and entities. Writes agent-internal items and entity links to Postgres.
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
  - batch_create_items
  - update_item
  - delete_item
  - upsert_entity
  - link_item_entity
  - get_unprocessed_threads
  - get_thread_messages
  - mark_thread_processed
  - list_threads
---

# memory_catchup

## Trigger
Cron: nightly (default "0 22 * * *")

## Relationship to post_process

The post_process skill's `afterAgent` hook is the first try — it runs immediately
after each conversation ends so new knowledge and entity links are available
same-day. This cron is the cleanup sweep that catches conversations where the
hook didn't fire.

Both use the same extraction logic and both diff against existing data,
so duplicates are naturally avoided.

## Behavior
1. Call `get_unprocessed_threads` to find conversations not yet processed.
2. For each unprocessed thread:
   a. Call `get_thread_messages` to retrieve the full message history.
   b. Skip threads with < 2 messages.
   c. Extract implicit knowledge (preferences, learned_facts, patterns).
   d. Extract named entities (person, project, company, topic, place, tool, concept).
   e. Deduplicate against existing items using `search_items` and `get_agent_knowledge`.
   f. Write memories via `create_item` (source: 'cron').
   g. Write entities via `upsert_entity` + `link_item_entity`.
   h. Call `mark_thread_processed` to flag the thread as done.
3. If a thread fails, log the error and continue with remaining threads.

## What Gets Extracted

**1. Implicit knowledge** — things the user didn't ask to be stored:
- User preferences ("prefers short confirmations")
- Personal facts ("partner is Emily")
- Behavioral patterns ("brain-dumps groceries on Thursday evenings")

**2. Entities + links** — people, projects, companies, topics, places:
- Extracted from conversation content
- Linked to items created during that conversation

NOT explicit asks — the agent handles these in real-time:
- "remind me to call the dentist Thursday" → reminder created immediately
- "eggs, milk, bread" → list items created immediately

## Dedup Strategy
1. Search existing items by semantic similarity before creating.
2. Similarity >= reinforce threshold (~0.95): reinforce — bump last_reinforced_at.
3. Similarity in update range (~0.85–0.95): supersede — create new, archive old.
4. Below threshold: create new item.

## Rules
- Be conservative. Only extract things with high confidence.
- Do not fabricate or infer beyond what the conversation clearly implies.
- Write memories as concise, third-person statements about the user.
- If a conversation has no extractable knowledge, skip it.
- Continue processing remaining threads even if one thread fails.
