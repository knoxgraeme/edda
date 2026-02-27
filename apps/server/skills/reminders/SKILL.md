---
name: reminders
description: >
  Schedule future notifications without an agent run. Supports one-shot
  ("at 5pm today") and recurring ("every Thursday at 9am") reminders.
  Reminders fire through the notification system — no LLM invocation needed.
allowed-tools:
  - create_reminder
  - list_reminders
  - cancel_reminder
---

# reminders

## Create Reminder

"remind me to wash the car at 5pm", "every Thursday at 9am remind me to take out the trash"

→ Parse the user's intent into a scheduled_at datetime and optional recurrence.
→ Convert the user's local time (from system context timezone) to ISO 8601 with UTC offset.
→ For recurring: use cron expressions (e.g. `0 9 * * 4` for Thursday 9am) or interval strings (e.g. `1 day`, `2 hours`).
→ Default targets: `['inbox']`. User can request channel delivery with "remind me on Telegram" → `['announce:<agent_name>']`.
→ Call create_reminder with the parsed parameters.
→ Confirm back: "I'll remind you to wash the car today at 5:00 PM."

## List Reminders

"what reminders do I have", "show my upcoming reminders"

→ Call list_reminders to show scheduled reminders.
→ Format: summary, next fire time (in user's timezone), recurrence if any.

## Cancel Reminder

"cancel the car wash reminder", "stop reminding me about trash"

→ First list_reminders to find the matching reminder by summary.
→ Call cancel_reminder with the reminder's ID.
→ Confirm: "Cancelled the reminder for washing the car."

## Cron Expression Patterns

Common patterns for the user's convenience:
- Every day at 9am: `0 9 * * *`
- Every weekday at 8am: `0 8 * * 1-5`
- Every Monday at 10am: `0 10 * * 1`
- Every Thursday at 9am: `0 9 * * 4`
- First of each month at noon: `0 12 1 * *`

## Interval Patterns

For simple recurring intervals:
- Every hour: `1 hour`
- Every 30 minutes: `30 minutes`
- Every 2 days: `2 days`
- Every week: `7 days`

## Important Notes

- Always use the user's timezone from system context when converting times.
- Store cron expressions in UTC. Convert user's local time intent to UTC cron.
- For one-shot reminders, don't set recurrence.
- Default priority is "normal". Use "high" only if the user emphasizes urgency.
