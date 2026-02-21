---
name: recall
description: >
  Retrieval and synthesis skill. Handles dashboard requests, semantic search,
  entity lookups, temporal queries, and list views. Use when the user is asking
  about past content, their schedule, or wants to see their daily overview.
---

# recall

## Dashboard Triggers
"what's today", "my day", "what's on my plate", "dashboard", "morning briefing"
→ Call get_dashboard for today. Format with icons from type definitions.
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
→ Call get_entity_items to get all linked items.
→ Summarize the arc — first mention, key events, recent activity.

## Temporal Triggers
"last week", "yesterday", "what happened in January", "the last 3 days"
→ Parse date range.
→ Call get_timeline with start/end dates.
→ Group by day, summarize each day briefly.

## List Triggers
"grocery list", "what's on my reading list", "show me my packing list"
→ Call get_list_items with the list name.
→ Show active items only (not completed/archived).

## Memory Transparency
"what do you know about me?", "what have you learned?"
→ Call search_items(agent_knowledge_only=true).
→ Present all learned preferences, facts, and patterns.
→ Remind the user they can ask to forget anything.

"forget that I prefer short confirmations", "delete that fact about Emily"
→ Call search_items(agent_knowledge_only=true, query="short confirmations").
→ Call update_item(id=..., status='archived').
→ Confirm: "Forgotten."
