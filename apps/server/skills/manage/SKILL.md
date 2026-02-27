---
name: manage
description: >
  Item modification skill. Handles completing, snoozing, editing, archiving items,
  list management, and processing confirmation approvals/rejections. Use when the
  user wants to change an existing item, manage a list, or respond to a pending
  confirmation.
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
  - create_list
  - update_list
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

## List Management

"rename my grocery list to Shopping"
→ update_list(list_name="grocery", name="Shopping")

"archive the Japan trip list"
→ update_list(list_name="japan trip", status="archived")

"move this item to my movies list"
→ update_item(id=..., list_id=<movies_list_id>)

"remove this from the list" / "take milk off the grocery list"
→ update_item(id=..., list_id=null) — removes from list but keeps the item
→ Or update_item(id=..., status="done") — marks complete (for tasks)
→ Or update_item(id=..., status="archived") — archives it
→ Ask the user which they mean if ambiguous.

## Bulk Operations
"I got everything on the grocery list", "clear the packing list"
→ get_list_contents(list_name="grocery") to find the list and its items
→ update_item for each active item → status='done'
→ For one-off lists (e.g. packing list): also update_list(list_name=..., status='archived')

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
