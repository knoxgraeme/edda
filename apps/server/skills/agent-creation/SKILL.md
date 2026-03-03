---
name: agent-creation
description: >
  Guided agent creation workflow. Walks through context gathering, system prompt
  authoring, skill selection and creation, schedule configuration, and memory
  seeding. Use when the user wants to create a new agent or substantially
  reconfigure an existing one. Triggers on "create an agent", "set up a new
  agent", "build me an agent that...".
allowed-tools:
  - create_agent
  - update_agent
  - list_agents
  - list_skills
  - install_skill
  - create_schedule
  - list_schedules
  - seed_agents_md
  - get_agents_md
  - get_settings
---

# agent-creation

Guided workflow for creating agents. Two user-facing confirmation gates; everything else is internal.

## Phase 1 — Context Gathering

Surface from the user:
- **Purpose**: What does this agent do?
- **Trigger**: Scheduled (cron) or on-demand?
- **Schedule**: If scheduled — when and how often?
- **Output**: Where do results go? (items, notifications, channels, store)
- **Boundaries**: What should it NOT do?
- **Integration**: Does it need MCP connections or cross-agent store access?
- **Model**: Any provider/model preference? (null = inherit from settings)

### Confirmation Gate 1

Summarize in plain language:

> "Here's what I'll set up: **[name]** will [purpose], running [schedule/on-demand], outputting to [destination]. It won't [boundaries]. Sound right?"

Wait for user confirmation before proceeding.

## Phase 2 — Architecture Decision (internal)

Decision tree — do NOT surface to user:

1. **Simple task with existing skills** → `system_prompt` + assign skills
2. **Complex workflow needing custom logic** → author custom skill via `install_skill`
3. **Pure prompt-driven agent** → `system_prompt` only, no skills beyond `self-improvement`

Use `list_skills` to discover available skills. Check if any existing skill covers the need before authoring a new one.

## Phase 3 — System Prompt Authoring (internal)

Write the agent's `system_prompt` using the Task/Output/Boundaries template.
See `references/prompt-templates.md` for archetype examples.

Rules:
- Be specific — numbered steps, not vague descriptions
- Include output expectations — where does the result go?
- Set boundaries — what should the agent NOT do?
- Don't include memory/communication preferences (those go in AGENTS.md)
- Don't repeat rules from system context (approval settings, etc.)

## Phase 4 — Skill Assignment & Creation (internal)

### Assigning existing skills
Select from `list_skills` output. Common assignments:
- `capture` + `recall` for conversational agents
- `daily-digest` for scheduled summary agents
- `reminders` for agents that manage time-based tasks
- `self-improvement` is auto-added (no need to specify)

### Creating custom skills
When no existing skill fits, author a new SKILL.md and install via `install_skill`.
See `references/skill-guide.md` for authoring conventions.

After installing, use `update_agent` to add the skill to the agent's skills array.

## Phase 5 — Schedule Setup

If the agent is scheduled:

1. Translate user's natural language timing to a 5-field cron expression
2. Write a clear prompt (the message sent to the agent on each trigger)
3. Set thread_lifetime: `ephemeral` for independent runs, `daily` for accumulating context

### Confirmation Gate 2

> "I'll set this to run [schedule description]. That right?"

Wait for confirmation, then call `create_schedule`.

### Notification targets
- `inbox` — creates a notification in the web UI
- `announce:<agent_name>` — delivers to linked channels (Telegram, Discord, Slack)
- `agent:<agent_name>:active` — triggers another agent run

## Phase 6 — Memory Seeding (internal)

Transfer relevant context to the new agent:

1. Read your own AGENTS.md via `get_agents_md`
2. Filter for broadly applicable content:
   - Communication preferences (tone, format, language)
   - Quality standards that apply across agents
3. Exclude agent-specific patterns and corrections
4. Call `seed_agents_md` with the filtered content

Only seed if there's genuinely useful context to transfer. An empty seed is fine for agents that will learn on their own.

## Phase 7 — Create & Verify

Execute all tool calls:
1. `create_agent` with name, description, system_prompt, skills, trigger, thread_lifetime, tools, subagents, model settings
2. `create_schedule` if scheduled (from Phase 5)
3. `seed_agents_md` if seeding (from Phase 6)

Report back:

> "Created **[name]**. It will [what], [schedule]. Let me know if you want to adjust anything."

## Common Patterns

### Scheduled digest agent
- Skills: `daily-digest` or custom
- Thread lifetime: `daily`
- Schedule: morning cron
- Notify: `inbox` + `announce:<agent_name>`
- Memory capture: `false` (no conversations to capture from)

### On-demand research agent
- Skills: custom + `recall`
- Thread lifetime: `persistent` (accumulates context)
- Trigger: `on_demand`
- Memory capture: `true`

### Monitoring/alert agent
- Skills: custom
- Thread lifetime: `ephemeral`
- Schedule: frequent cron (e.g. hourly)
- Notify: `inbox`
- Boundary: don't create items for non-alerts
