---
name: manage
description: >
  Item modification skill. Handles completing, snoozing, editing, archiving items,
  and processing confirmation approvals/rejections. Use when the user wants to
  change an existing item or respond to a pending confirmation.
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
  - delete_item
  - confirm_pending
  - reject_pending
  - list_pending_items
  - get_settings
---

# manage

## Complete
"done with X", "finished X", "got the groceries", "check off the dentist"
→ Find item by semantic search among recent active items.
→ call update_item(id, status='done')
→ "Marked done: call the dentist ✓"

## Snooze
"push X to Friday", "remind me about X later", "move that to next week"
→ Find item → update_item(metadata.due_date = new_date)
→ "Pushed dentist call to Friday the 28th."

## Edit
"actually it was Tuesday not Wednesday", "change the priority to high"
→ Find item → update content or metadata → re-embed if content changed.

## Archive
"never mind about X", "remove X", "I don't need that anymore"
→ Find item → update_item(status='archived')

## Bulk Operations
"I got everything on the grocery list", "clear the packing list"
→ search_items(type="list", query="grocery") to find the list
→ get_list_contents(list_id) → update_item for each active item → status='done'
→ For one-off lists (e.g. packing list): also update_item on the list itself → status='done'

## Rename List
"rename the grocery list to 'weekly groceries'"
→ search_items(type="list", query="grocery") to find the list
→ update_item(id, content="Weekly Groceries", metadata={...existing, normalized_name: "weekly groceries"})
→ "Renamed list to Weekly Groceries."

## Archive List
"remove the packing list", "delete the grocery list"
→ search_items(type="list", query="packing") to find the list
→ get_list_contents(list_id) → update_item(status='archived') for EACH active child item
→ THEN update_item on the list itself → status='archived'
→ "Archived packing list and its 5 items."
⚠️ Always archive children BEFORE the parent to prevent orphaned items.

## Remove List Item
"take eggs off the grocery list", "remove milk"
→ search_items(type="list", query="grocery") to find the list
→ get_list_contents(list_id) to find the specific item
→ update_item(id, status='archived')

## Discover Lists
To find all lists including empty ones: search_items(type="list")
The daily summary only shows lists with active items. Use search_items for a complete inventory.

## Confirm / Reject Pending Items
"yes do it", "approve the recipe type", "no don't archive those"
→ Call confirm_pending(id) or reject_pending(id)

## Confirmation System

Some actions require user approval depending on settings. When an approval mode
is "confirm", the agent creates the row with confirmed=false and a pending_action
description. The item stays in the table but won't appear in normal queries.
The user sees it on their dashboard under "Needs Your Confirmation."

When the user approves: call confirm_pending to set confirmed=true.
When they reject: call reject_pending to revert or delete.

Read current approval settings from the system prompt or settings tool.

## Item Resolution
When the user says "the dentist thing" or "that meeting", search by semantic
similarity among recent items. If ambiguous (multiple close matches), present
options and let the user pick.
