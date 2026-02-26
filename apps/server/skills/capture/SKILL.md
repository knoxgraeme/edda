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
  - create_list
  - update_list
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
3. For lists:
   - BEFORE creating any list, ALWAYS check if one exists:
     get_list_contents(list_name="<inferred name>")
     If a similar list exists, ask the user: "You already have a '...' list —
     add to that one, or create a separate list?" Do NOT silently create duplicates.
   - To CREATE A NEW LIST: create_list(name="Movies to Watch",
     summary="Movies recommended by friends or that I want to see", list_type="rolling")
   - To ADD ITEMS TO A LIST: create_item(type="note", list_name="movies to watch",
     content="Inception", metadata={recommended_by: "Tom", category: "movie"})
     Or use batch_create_items for multiple items.
   - ALWAYS set a meaningful `summary` on new lists.
   - Items on a list keep their behavioral type: use "task" if it should be checkable,
     "reminder" if it has a due date, "note" for everything else.
   - Use list_type "rolling" for recurring/ongoing lists (grocery, movies, books)
     and "one_off" for temporary lists (trip packing, moving checklist).
4. For common metadata: when the user mentions who recommended something, a URL,
   a category, or a source — always include these in metadata:
   - recommended_by: who suggested it
   - url: any associated link
   - category: what kind of thing it is (movie, book, restaurant, etc.)
   - source: where they heard about it
   These fields work on any item type on any list.
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

Input: "create a list of movies to watch"
→ get_list_contents(list_name="movies to watch") — check for existing
→ None found → create_list(name="Movies to Watch",
  summary="Movies recommended by friends or that I want to see", list_type="rolling")
→ Response: "📋 Created list: Movies to Watch"

Input: "Tom recommended I watch Inception"
→ get_list_contents() — check active lists for a movie/watch list
→ If "Movies to Watch" exists → create_item(type="note", list_name="movies to watch",
  content="Inception — recommended by Tom",
  metadata={recommended_by: "Tom", category: "movie"})
→ Response: "Added Inception to Movies to Watch"
→ If no relevant list → "I don't have a movies list yet — want me to create one
  and add Inception to it?"

Input: "eggs, milk, bread"
→ get_list_contents(list_name="grocery") — find existing
→ batch_create_items([
   {type: "note", list_name: "grocery", content: "Eggs"},
   {type: "note", list_name: "grocery", content: "Milk"},
   {type: "note", list_name: "grocery", content: "Bread"}
 ])
→ Response: "🛒 Added 3 items to Grocery List"

Input: "save this article https://example.com/good-read"
→ create_item(type="note", content="Good read — example.com",
  metadata={url: "https://example.com/good-read", category: "article"})
→ If a "Read Later" list exists, add to it. Otherwise standalone note.
→ Response: "📝 Saved: Good read"

Input: "remind me to pack my adapter for Japan, trip is April 5"
→ create_item(type="reminder", list_name="japan trip",
  content="Pack adapter", metadata={due_date: "2026-04-01"})
→ Response: "🔔 Reminder set: Pack adapter — April 1 (on Japan Trip list)"

Input: "met with Sarah, she's pushing back on the Q2 timeline. We agreed to cut the admin dashboard."
→ batch_create_items([
   {type: "meeting", content: "Met with Sarah about Q2 timeline...", metadata: {attendees: ["Sarah"]}},
   {type: "decision", content: "Cut admin dashboard from first release", parent_id: <meeting_id>}
 ])
→ Response: "🤝 Meeting with Sarah logged. ⚖️ Decision captured: cut admin dashboard."

(Entity extraction — Sarah, Q2 timeline — happens automatically after the conversation.)

## Response Style
- Confirm with a brief icon + summary.
- NEVER explain internal data model details to the user.
- "📋 Created list: Movies to Watch" — not a paragraph about types and schemas.
