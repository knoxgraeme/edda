---
name: memory_extraction
description: >
  Daily post-processing cleanup. Runs as a cron job after daily_digest. Reviews
  conversation threads from the day where the afterAgent hook didn't fire (tab close,
  crash, Ctrl+C) and extracts missed implicit knowledge + entities. Writes agent-internal
  items and entity links to Postgres.
---

# memory_extraction

## Trigger
Cron: settings.memory_extraction_cron (default "0 22 * * *")

## Relationship to EddaPostProcessMiddleware

EddaPostProcessMiddleware's `afterAgent` hook is the first try — it runs immediately after
each conversation ends so new knowledge and entity links are available same-day. This
cron is the cleanup sweep that catches conversations where the hook didn't fire.

Both use the same extraction prompt and both diff against existing data,
so duplicates are naturally avoided.

## What Gets Extracted

Two things, in a single LLM call per conversation:

**1. Implicit knowledge** — things the user didn't ask to be stored:
- User preferences ("prefers short confirmations")
- Personal facts ("partner is Emily")
- Behavioral patterns ("brain-dumps groceries on Thursday evenings")

**2. Entities + links** — people, projects, companies, topics, places:
- Extracted from conversation content
- Linked to items created during that conversation
- Enables entity-based recall ("everything about Sarah")

NOT explicit asks — the agent handles these in real-time:
- "remind me to call the dentist Thursday" → reminder created immediately
- "eggs, milk, bread" → list items created immediately

## Behavior
1. Get all conversation threads updated today via checkpointer.
2. For each thread, check if afterAgent already processed it.
   (Check: is processed_by_hook=true in thread metadata? If yes, skip.)
   This flag is set by the afterAgent hook regardless of whether extraction
   found anything — a conversation with zero entities still gets flagged.
3. For unprocessed threads, retrieve message history via checkpointer.
4. Skip threads with < 2 messages.
5. Load existing agent-internal items to diff against.
6. Call settings.memory_extraction_model with the combined extraction prompt
   (same prompt as EddaPostProcessMiddleware).
7. Write memories: create items with source='cron'.
8. Write entities: upsert_entity + link_item_entity for each extracted entity.

## Cost
Uses settings.memory_extraction_model (default: Haiku). Focused prompt, no tools.
Typical cost: ~$0.01-0.05/day depending on missed conversations.
In the common case (afterAgent processed everything), this is a no-op.
