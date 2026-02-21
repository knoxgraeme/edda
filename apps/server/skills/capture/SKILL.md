---
name: capture
description: >
  Universal intake skill. Classifies user input into the most specific item type,
  extracts metadata, and stores everything anchored to today. Use this skill
  whenever the user is giving you something to remember, track, or save.
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
4. For meetings: create child items (type=decision, type=task) linked via parent_id.
   Use batch_create_items to create the meeting + children in one call.
5. For journal: respect privacy — these are excluded from casual recall.
6. Every item anchors to today unless the user specifies a different date.
7. If one message contains multiple distinct items, create each separately
   via batch_create_items.

## Type Reference

For full extraction hints and metadata schemas for each type:
→ Read `references/types.md`

This file is generated from the item_types table and contains the extraction_hint,
metadata_schema, and behavioral flags for every active type. Always consult it before
extracting metadata — new types may have been added since your training.

## Tool Sequence

Typical capture flow:
1. Classify type (consult type list in system prompt or references/types.md)
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
