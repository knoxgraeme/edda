---
name: user_crons
description: >
  Handles user requests to create automated recurring tasks. Use when the user
  says "every Monday", "at 6pm each day", "weekly on Friday", or any request
  to schedule a repeating automated action.
allowed-tools:
  - search_items
  - get_item_by_id
  - get_entity_items
  - get_entity_profile
  - list_entities
  - get_agent_knowledge
  - get_dashboard
  - get_timeline
  - get_list_items
  - create_item
  - update_item
---

# user_crons

## What This Does

Creates a `scheduled_task` item that the cron runner will execute on schedule.
The user describes WHEN and WHAT in natural language. You parse it into a cron
expression and an action description.

## Creating a Scheduled Task

1. Parse the schedule into a cron expression. Confirm it back to the user.
2. Identify the action — what should happen when this fires.
3. Call create_item with:
   - type: "scheduled_task"
   - content: the full user request (for reference)
   - metadata: { cron, cron_human, action, enabled: true }

## Examples

"Every Monday morning, summarize my open tasks"
→ create_item(type="scheduled_task", content="Weekly task summary",
    metadata={cron: "0 8 * * 1", cron_human: "Every Monday at 8 AM",
              action: "Search for all active tasks and create a summary"})
→ "⏰ Scheduled: Every Monday at 8 AM, I'll summarize your open tasks."

"At 6pm each day, remind me to journal"
→ create_item(type="scheduled_task", content="Daily journal reminder",
    metadata={cron: "0 18 * * *", cron_human: "Every day at 6 PM",
              action: "Create a reminder to journal"})
→ "⏰ Scheduled: Every day at 6 PM, I'll remind you to journal."

"Every Friday at 5, review my week and create a summary"
→ create_item(type="scheduled_task", content="Weekly review",
    metadata={cron: "0 17 * * 5", cron_human: "Every Friday at 5 PM",
              action: "Pull all items from the week, summarize activity and completions, create an insight item"})
→ "⏰ Scheduled: Every Friday at 5 PM, I'll review your week."

## What Can a Scheduled Task Do?

Anything you can do in a normal conversation — the cron runner gives the execution
agent the same tools (Edda tools + web search + MCP connections). So:
- Create items (reminders, notes, summaries)
- Search and synthesize past items
- Use web search for current information
- Use MCP tools (send email, create Notion page, post to Slack)

## Managing Scheduled Tasks

"show my scheduled tasks" → search_items(type="scheduled_task")
"disable the Monday summary" → update_item(id, metadata={...enabled: false})
"change it to Tuesday" → update_item(id, metadata={...cron: "0 8 * * 2", cron_human: "Every Tuesday at 8 AM"})
"delete the journal reminder" → update_item(id, status="archived")
