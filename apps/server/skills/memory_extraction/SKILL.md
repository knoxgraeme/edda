---
name: memory_extraction
description: >
  Knowledge extraction from conversations. Extracts implicit preferences, facts,
  patterns, and named entities from conversation transcripts. Writes agent-internal
  items and entity links to Postgres with semantic dedup. Produces a session_summary
  retrospective per processing pass. Supports incremental processing of long-lived
  threads via message-count watermarks.
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

# memory_extraction

## Purpose

Extract implicit knowledge, entities, and retrospective learnings from
conversations and persist them to the knowledge base. Four extraction
targets in a single pass:

### 1. Implicit Knowledge (memories)
Things the user revealed implicitly — NOT things they explicitly asked to store.

Types:
- **preference**: User likes/dislikes, communication style, workflow habits
- **learned_fact**: Personal details, relationships, work info, biographical facts
- **pattern**: Recurring behaviors, schedules, routines

Examples of what TO extract:
- "prefers short confirmations over verbose responses"
- "partner's name is Emily"
- "works at Acme Corp as a senior engineer"
- "brain-dumps groceries on Thursday evenings"

Examples of what NOT to extract:
- Items the user explicitly asked to store (tasks, reminders, notes — already saved)
- Greetings, small talk, or meta-conversation about the assistant
- Information too vague or contextual to be a lasting fact

### 2. Named Entities
Types: person, project, company, topic, place, tool, concept.
- Use canonical names (e.g. "Sarah Chen" not "Sarah")
- Include aliases if conversation used shorthand (e.g. "k8s" for "Kubernetes")

### 3. Entity Relationships
- **mentioned**: Entity referenced in passing
- **about**: An item is primarily about this entity
- **assigned_to**: Task/action assigned to this entity
- **decided_by**: Decision made by this entity

### 4. Session Summary (retrospective)
After extracting knowledge and entities, produce a **single `session_summary`
item** per processing pass that captures what you learned about serving this user.

This is the most important output for long-term improvement. Corrections and
quality signals feed directly into the weekly self-reflection process.

A session summary has these metadata fields:
- **thread_id** — the thread UUID being processed
- **message_count** — total messages in the thread at time of processing (used as watermark)
- **corrections** — things the user corrected during the conversation
  (e.g. "asked me to stop summarizing every reply", "said the format was wrong")
- **preferences_observed** — new communication or format preferences noticed
  (e.g. "prefers numbered lists over bullets", "wants short confirmations")
- **quality_signals** — what went well or poorly
  (e.g. "user said thanks and moved on quickly", "user had to repeat the same
  request twice", "user explicitly said output was helpful")

**Rules for session summaries:**
- Create one per processing pass if the messages had meaningful interaction
- Skip if only trivial content in the processed segment (greetings, single questions)
- Focus on what you LEARNED, not what HAPPENED — this is a retrospective
- Corrections are the highest-value signal — always capture these
- Empty arrays are fine if nothing was observed for a field
- The `content` field should be a 1-2 sentence natural language summary of
  the key learning

**Example:**
```json
{
  "type": "session_summary",
  "content": "User corrected summary length and showed preference for bullet-point format over prose",
  "metadata": {
    "thread_id": "abc-123",
    "message_count": 24,
    "corrections": ["summaries were too long — user wants 3 bullets max"],
    "preferences_observed": ["prefers bullet points over prose paragraphs"],
    "quality_signals": ["user re-asked for shorter output — initial response was too verbose"]
  }
}
```

## Triggers

This skill is used by two agents with different triggers:

1. **memory_writer** (post_conversation) — runs immediately after each conversation
   ends so new knowledge and entity links are available same-day.
2. **memory_catchup** (nightly cron) — cleanup sweep that catches conversations where
   the post-conversation hook didn't fire (tab close, crash, Ctrl+C).

Both use the same extraction logic and both diff against existing data,
so duplicates are naturally avoided.

## Behavior (nightly catch-up mode)

1. Call `list_unprocessed_threads` to find conversations not yet processed.
2. For each unprocessed thread:
   a. Call `get_thread_messages` to retrieve the full message history.
   b. Skip threads with < 2 messages.
   c. **Check for prior processing** (see Incremental Processing below).
   d. Extract implicit knowledge and entities from the relevant messages.
   e. Create a session summary for the processed segment.
   f. Call `mark_thread_processed` to flag the thread as done.
3. If a thread fails, log the error and continue with remaining threads.

## Incremental Processing (long-lived threads)

Not all threads are short conversations. `daily` context threads persist for a full
day, and `persistent` threads live forever. These threads accumulate messages over
time and need to be processed incrementally.

**Watermark strategy:**

Before extracting from a thread, search for existing session summaries for that
thread to find the watermark:

```
search_items({ query: "session summary", type: "session_summary", metadata: { thread_id: "<thread_id>" }, limit: 5 })
```

Check the `message_count` in the most recent session summary's metadata for this
thread. This is the watermark — the number of messages already processed.

- **No prior summary found**: Process the full thread (first pass).
- **Prior summary found with message_count = N**: Only process messages after
  position N. Use `get_thread_messages` to retrieve all messages, then focus
  extraction on messages from index N onward.
- **Prior summary found but message_count = current total**: No new messages —
  skip this thread.

**Minimum segment size:** Only process a segment if it contains >= 4 new messages.
Smaller segments rarely contain extractable knowledge and waste tokens.
If a segment has fewer than 4 new messages, skip processing but do NOT mark the
thread as processed. It will be re-evaluated on the next run when more messages
may have accumulated.

When creating the session summary, always set `message_count` to the total
message count at time of processing (not just the segment size). This becomes
the watermark for the next pass.

## Rules
- Be conservative. Only extract things with high confidence.
- Do not fabricate or infer beyond what the conversation clearly implies.
- Write memories as concise, third-person statements about the user.
- If the conversation has no extractable knowledge, do nothing.
- Session summaries focus on LEARNING, not event logging — "what did I learn
  about serving this user?" not "what did the user ask me to do?"
- For incremental passes, only extract from new messages — don't re-extract
  from already-processed segments.

## Available Tools
- `create_item` — Store extracted memories (type: preference/learned_fact/pattern/session_summary)
- `update_item` — Reinforce or supersede existing memories
- `search_items` — Semantic dedup + watermark lookup for session summaries
- `upsert_entity` — Create or merge entities
- `list_entity_items` — Check existing entity relationships
- `link_item_entity` — Link entities to items created during the conversation
- `mark_thread_processed` — Flag thread as processed to avoid reprocessing
- `get_item_by_id` — Look up specific items

## Dedup Strategy

### Memories
`create_item` automatically handles near-exact duplicates (hardcoded similarity >= 0.95) by
reinforcing the existing item instead of creating a new one. You do NOT need to
manually search-and-dedup for those cases.

You only need to handle the **supersede** case (similarity ~0.85–0.95) yourself:
1. Search existing items (agent_knowledge_only) by semantic similarity
2. If a result falls in the 0.85–0.95 range, the old item is outdated — create
   the new item and archive the old one via `update_item`
3. If no similar result exists (below 0.85), just call `create_item` normally

### Entities
1. Search existing entities by semantic similarity
2. Exact match (~0.95): merge aliases, bump mention_count
3. Fuzzy match (~0.80–0.95): auto-merge or create unconfirmed (per settings)
4. No match: create new entity

### Session Summaries
Session summaries are NOT deduplicated — each processing pass gets its own.
They are append-only and decay naturally (30-day half-life). The `message_count`
field in metadata serves as the watermark for incremental processing.
