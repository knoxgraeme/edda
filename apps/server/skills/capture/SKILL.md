---
name: capture
description: >
  Universal intake skill. Classifies user input into the most specific item type,
  extracts metadata, and stores everything anchored to today. Use this skill
  whenever the user is giving you something to remember, track, or save.
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
---

# capture

## Fast Path / Slow Path

Your job during the conversation is the FAST PATH only:
- Classify the input
- Create items (use batch_create_items for multiple)
- Respond immediately

Entity extraction and linking happens AUTOMATICALLY in a background hook
after the conversation ends. You do NOT need to call upsert_entity or
link_item_entity. Just focus on creating items quickly and confirming.

## Core Rules

1. Pick the MOST SPECIFIC type that fits. When uncertain, use "note" but flag
   it as a type evolution candidate in the agent log.
2. For reminders/tasks: always parse dates to concrete values and confirm them
   back to the user ("Reminder set for Thursday Feb 26").
3. For list items: infer the list name from context. "eggs and milk" → groceries.
   Use batch_create_items for multiple items in a single message.
4. For recommendations: always include `category` in metadata (e.g. "movie", "book",
   "restaurant", "podcast"). Write rich content that includes what it is and who
   recommended it. Before creating, use search_items with type="recommendation" to
   check existing categories and reuse them — avoid drift ("movies" vs "movie").
5. For meetings: create child items (type=decision, type=task) linked via parent_id.
   Use batch_create_items to create the meeting + children in one call.
6. For journal: respect privacy — these are excluded from casual recall.
7. Every item anchors to today unless the user specifies a different date.
8. If one message contains multiple distinct items, create each separately
   via batch_create_items.

## Type Reference

Item types with classification hints, extraction hints, and metadata schemas are
included in the AGENTS.md section of the system prompt. This is curated by the
context_refresh skill from the item_types table. Consult the system prompt for
available types — new types may have been added since your training.

## Tool Sequence

Typical capture flow:
1. Classify type (consult type list in system prompt)
2. Single item: call create_item(type, content, summary, metadata, day)
   Multiple items: call batch_create_items([{type, content, summary, metadata, day}, ...])
3. Respond with brief confirmation: icon + summary + any parsed dates

That's it. Entity extraction happens in the background after the conversation.

## Examples

Input: "remind me to call the dentist next Thursday"
→ create_item(type="reminder", content="Call the dentist", metadata={due_date: "2026-02-26"})
→ Response: "🔔 Reminder set: Call the dentist — Thursday Feb 26"

Input: "eggs, milk, that good bread from Trader Joe's"
→ batch_create_items([
    {type: "list_item", content: "Eggs", metadata: {list_name: "groceries"}},
    {type: "list_item", content: "Milk", metadata: {list_name: "groceries"}},
    {type: "list_item", content: "Bread (Trader Joe's)", metadata: {list_name: "groceries", store: "Trader Joe's"}}
  ])
→ Response: "🛒 Added 3 items to groceries"

Input: "met with Sarah, she's pushing back on the Q2 timeline. We agreed to cut the admin dashboard."
→ batch_create_items([
    {type: "meeting", content: "Met with Sarah about Q2 timeline...", metadata: {attendees: ["Sarah"]}},
    {type: "decision", content: "Cut admin dashboard from first release", parent_id: <meeting_id>}
  ])
→ Response: "🤝 Meeting with Sarah logged. ⚖️ Decision captured: cut admin dashboard."

(Entity extraction — Sarah, Q2 timeline — happens automatically after the conversation.)

Input: "Dave recommended I watch Sleepless Night"
→ create_item(type="recommendation", content="Sleepless Night (movie) — recommended by Dave",
    summary="Movie recommendation from Dave", metadata={category: "movies", recommended_by: "Dave"})
→ Response: "⭐ Saved: Sleepless Night (movie) — recommended by Dave"
