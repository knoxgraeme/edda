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
  - add_mcp_connection
  - list_mcp_connections
  - update_mcp_connection
  - remove_mcp_connection
  - update_settings
  - get_settings
---

# admin

## Agent Management

### Create Agent
"create an agent that...", "set up a new cron to..."
- create_agent: Create a new agent with name, description, skills, schedule, etc.
- Max 30 agents enforced. Rejects schedules faster than every 5 minutes.
- Name must be snake_case.

### View Agents
"show me all agents", "what agents are running?"
- list_agents: View all configured agents and their status.

### Modify Agent
"change the daily digest schedule", "disable the weekly reflect agent"
- update_agent: Modify an existing agent's configuration.
- Can update: description, system_prompt, skills, schedule, enabled, context_mode, metadata.

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

## MCP Connections

### Add Connection
"connect to my MCP server at..."
- add_mcp_connection: Register a new MCP server connection via SSE transport.
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

## Settings

### View Settings
"what are my current settings?"
- get_settings: View current agent-safe configuration (user-facing keys only).

### Update Settings
"change my timezone", "set approval mode to auto"
- update_settings: Modify agent-safe settings.
- Only user-facing keys can be modified: user_display_name, user_timezone,
  daily_digest_time, web_search settings, approval modes, AGENTS.md budgets.
- Infrastructure keys (LLM provider, model, etc.) cannot be modified by agents.
