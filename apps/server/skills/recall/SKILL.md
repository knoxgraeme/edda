---
name: recall
description: >
  Retrieval and synthesis skill. Handles dashboard requests, semantic search,
  entity lookups, temporal queries, and list views. Use when the user is asking
  about past content, their schedule, or wants to see their daily overview.
allowed-tools:
  - search_items
  - get_item_by_id
  - list_entity_items
  - get_entity_profile
  - list_entities
  - get_daily_summary
  - get_timeline
  - get_list_contents
  - update_item
---

# recall

## Dashboard Triggers
"what's today", "my day", "what's on my plate", "dashboard", "morning briefing"
→ Call get_daily_summary for today. Format with icons from type definitions.
→ Include the pending_confirmations section if any exist.
→ Use a clean, scannable format. Group by section (due today, captured, open, lists).

## Semantic Search Triggers
Topic questions, "what did I say about...", "that thing about...", "anything about..."
→ Call search_items with the semantic query.
→ Respect privacy: journal items excluded unless the user specifically asks.
→ Synthesize results into a coherent answer. Don't dump raw items.

## Entity Triggers
"everything about X", "when did I mention X", "what's happening with project Y"
→ Resolve entity by searching entities table.
→ Call get_entity_profile for a rich summary (description, linked items, activity).
→ If deeper detail is needed, call list_entity_items for all linked items.
→ Summarize the arc — first mention, key events, recent activity.

## Temporal Triggers
"last week", "yesterday", "what happened in January", "the last 3 days"
→ Parse date range.
→ Call get_timeline with start/end dates.
→ Group by day, summarize each day briefly.

## List Triggers
"what lists do I have", "show me my lists", "my lists"
→ Call get_list_contents() with NO arguments — returns all lists with item counts.

"grocery list", "what's on my reading list", "show me my packing list"
→ Call get_list_contents(list_name="grocery") — use the short natural name.
→ If no list found, call get_list_contents() to show all available lists
  and suggest the closest match.

## Category & Metadata Queries
"my movie recommendations", "what restaurants have I saved", "books to read",
"what did Tom recommend", "things to watch"
→ First check for a matching list: get_list_contents(list_name="movies to watch")
→ Also search by metadata: search_items(metadata={recommended_by: "Tom"})
  or search_items(metadata={category: "movie"})
→ Combine results — items may live on a list or be standalone notes with metadata.

## Memory Transparency
"what do you know about me?", "what have you learned?"
→ Call search_items(agent_knowledge_only=true).
→ Present all learned preferences, facts, and patterns.
→ Remind the user they can ask to forget anything.

"forget that I prefer short confirmations", "delete that fact about Emily"
→ Call search_items(agent_knowledge_only=true, query="short confirmations").
→ Call update_item(id=..., status='archived').
→ Confirm: "Forgotten."
