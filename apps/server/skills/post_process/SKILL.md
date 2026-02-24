---
name: post_process
description: >
  Post-conversation knowledge extraction. Extracts implicit preferences, facts,
  patterns, and named entities from conversation transcripts. Writes agent-internal
  items and entity links to Postgres with semantic dedup.
---

# post_process

## Purpose

Extract implicit knowledge and entities from conversations and persist them
to the knowledge base. Two extraction targets in a single pass:

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

## Rules
- Be conservative. Only extract things with high confidence.
- Do not fabricate or infer beyond what the conversation clearly implies.
- Write memories as concise, third-person statements about the user.
- If the conversation has no extractable knowledge, do nothing.

## Available Tools
- `create_item` — Store extracted memories (type: preference/learned_fact/pattern, source: "posthook")
- `update_item` — Reinforce or supersede existing memories
- `search_items` — Semantic dedup: check for similar existing items before creating
- `upsert_entity` — Create or merge entities
- `get_entity_items` — Check existing entity relationships
- `link_item_entity` — Link entities to items created during the conversation
- `mark_thread_processed` — Flag thread as processed to avoid reprocessing
- `get_agent_knowledge` — View existing agent knowledge for dedup
- `get_item_by_id` — Look up specific items

## Dedup Strategy

### Memories
1. Search existing items (agentKnowledgeOnly) by semantic similarity
2. Similarity >= reinforce threshold (~0.95): reinforce — bump last_reinforced_at
3. Similarity in update range (~0.85–0.95): supersede — create new item, archive old
4. Similarity below update threshold: create new item

### Entities
1. Search existing entities by semantic similarity
2. Exact match (~0.95): merge aliases, bump mention_count
3. Fuzzy match (~0.80–0.95): auto-merge or create unconfirmed (per settings)
4. No match: create new entity
