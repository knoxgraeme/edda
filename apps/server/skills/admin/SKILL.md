---
name: admin
description: >
  System administration skill. Manages agents (CRUD), triggers on-demand agent
  runs, monitors task results, configures MCP connections, and updates system
  settings. Use when the user wants to configure the system rather than manage
  their personal items.
allowed-tools:
  - create_agent
  - list_agents
  - update_agent
  - delete_agent
  - run_agent
  - get_task_run
  - create_schedule
  - list_schedules
  - update_schedule
  - delete_schedule
  - add_mcp_connection
  - list_mcp_connections
  - update_mcp_connection
  - remove_mcp_connection
  - update_settings
  - get_settings
  - get_notifications
  - list_channels
  - manage_channel
---

# admin

## Agent Management

### Create Agent
"create an agent that...", "set up a new cron to..."
- For full guided agent creation (prompt authoring, skill selection, schedule setup, memory seeding), use the `agent-creation` skill.
- For quick creation: `create_agent` with name, description, and skills.

### View Agents
"show me all agents", "what agents are running?"
- list_agents: View all configured agents and their status.

### Modify Agent
"change the daily digest schedule", "disable the weekly reflect agent"
- update_agent: Modify an existing agent's configuration.
- Can update: description, system_prompt, skills, schedule, enabled, thread_lifetime, metadata.

### Delete Agent
"remove that agent I created"
- delete_agent: Remove a user-created agent.
- System agents cannot be deleted — warn the user if they try.

### Run Agent
"run the daily digest now", "trigger type evolution"
- run_agent: Trigger an on-demand execution of any agent.
- Fire-and-forget with concurrency control. Returns task_run_id for status checking.
- 5-minute timeout per run.

### Check Results
"did the digest run succeed?", "what happened with the last agent run?"
- get_task_run: Check status and results of recent agent runs.
- Can look up specific run by ID or list recent runs by agent.

## Schedules

### List Schedules
"what schedules does digest have?", "show me all cron jobs"
- list_schedules: List all schedules for an agent by name.

### Modify Schedule
"change the daily digest to run at 8am", "disable the weekly report schedule"
- update_schedule: Update cron, prompt, thread_lifetime, notify targets, or enabled flag.
- Requires the schedule_id (get from list_schedules).

### Delete Schedule
"remove that schedule"
- delete_schedule: Permanently delete a schedule.

## MCP Connections

### Add Connection
"connect to my MCP server at..."
- add_mcp_connection: Register a new MCP server connection.
- **Always provide a `name`** — a short, descriptive label (e.g. "ahrefs", "notion", "slack"). Never omit the name field.
- Auth tokens stored in env vars, never passed directly.

### View Connections
"what integrations are set up?"
- list_mcp_connections: List all enabled MCP connections.

### Modify Connection
"disable the Slack MCP", "rename that connection"
- update_mcp_connection: Enable/disable or rename an MCP connection.

### Remove Connection
"remove the old MCP server"
- remove_mcp_connection: Delete an MCP connection.

## Notifications

### View Notifications
"show my notifications", "any unread notifications?"
- get_notifications: List notifications with optional status filter (unread, read, dismissed).
- Returns most recent notifications, ordered by creation date.

## Channels

### List Channels
"what channels are connected?", "show linked channels for digest"
- list_channels: List external channels (e.g. Telegram, Discord, Slack) linked to an agent.
- Can filter by agent name.

### Manage Channel
"link Telegram to the digest agent", "disable announcements for that channel"
- manage_channel: Link, unlink, or update an agent's external channel configuration.
- Controls receive_messages and receive_announcements flags.

## Settings

### View Settings
"what are my current settings?"
- get_settings: View current agent-safe configuration (user-facing keys only).

### Update Settings
"change my timezone", "set approval mode to auto", "enable sandbox execution"
- update_settings: Modify agent-safe settings.
- Only user-facing keys can be modified: user_display_name, user_timezone,
  web_search settings, approval modes, AGENTS.md budgets, sandbox_provider.
- Infrastructure keys (LLM provider, model, etc.) cannot be modified by agents.

## Sandbox Execution

Agents with the `coding` skill gain shell execution via the `execute` tool.
Requires `sandbox_provider` to be set to `node-vfs` in settings.

- The sandbox is a guardrail (env stripping, command denylist), not a hard security boundary.
- `node-vfs` runs commands in an in-memory VFS — suitable for dev/tinkering.
- The coding skill declares an allowlist of permitted commands (node, npm, git, etc.).
- Shell injection patterns ($, backticks, ;, &&, ||, |) are blocked.
- To enable: `update_settings({ sandbox_provider: "node-vfs" })`
