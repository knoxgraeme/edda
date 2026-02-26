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
- The `self_improvement` skill is automatically added to new agents.
- An empty AGENTS.md (procedural memory) is automatically seeded on creation.

#### Writing System Prompts

When creating an agent, always write a structured `system_prompt` that gives
the agent clear instructions. Use this template:

```
You are {agent_name}, an Edda agent.

## Task
1. {first step — what the agent does}
2. {second step}
3. {third step}

## Output
- {where results go — /store/, items, notifications, etc.}
- {format expectations}

## Boundaries
- {what it should NOT do}
- {edge cases to handle carefully}
```

**Rules for writing system prompts:**
- Be specific about the task — numbered steps, not vague descriptions
- Include output expectations — where does the result go?
- Set boundaries — what should the agent NOT do?
- Don't include memory/communication preferences — those go in AGENTS.md
- Don't repeat rules that are in the system context (approval settings, etc.)

**Examples:**

Good: "1. Check inbox for unread emails. 2. Summarize each in 1-2 sentences.
3. Flag action-required emails as tasks."

Bad: "You are a helpful email assistant." (too vague — no steps, no output, no boundaries)

Good: "## Boundaries\n- Never unsubscribe from senders in Key People\n- Ask before deleting any email"

Bad: "Be careful with emails." (not actionable)

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
