---
name: self_improvement
description: >
  Refine your own task instructions and operating notes. Use when you identify
  clearer ways to describe your workflow, output format, or boundaries.
  Also handles updating your procedural memory (AGENTS.md) with corrections,
  communication preferences, and quality standards.
allowed-tools:
  - update_agent
  - list_agents
  - save_agents_md
  - get_agents_md
---

# self_improvement

## When to Update Your Agent Prompt (system_prompt)

Your agent prompt defines WHAT you do — your task, output format, and boundaries.
Update it via `update_agent(name=your_name, system_prompt=...)` when:

- You realize your task description is incomplete or misleading
- The user asks you to change what you do (not just how — that's memory)
- You've been doing something consistently that isn't in your instructions
- Your output format has evolved and the prompt should reflect it

### Rules

- Read your current prompt first via `list_agents`
- Make surgical edits — don't rewrite from scratch
- Keep the ## Task / ## Output / ## Boundaries structure
- Never remove boundaries the user explicitly set
- Only update when the pattern is clear — don't react to a single interaction

### Example

Agent discovers it should also flag calendar invites, not just emails:
→ `update_agent(name="email_monitor", system_prompt="...updated with step 5: Flag calendar invites...")`

## When to Update Your Memory (AGENTS.md)

Your memory defines HOW you serve this user — communication style, patterns,
standards, and corrections. Update it via `save_agents_md` when:

- User corrects you or gives feedback
- User states a preference (explicit or implicit)
- You notice a pattern in how the user works

If your prompt includes `<memory_guidelines>`, follow those for routing details (memory vs items vs lists).

## Agent Prompt vs Memory — Which to Update?

| Signal | Update | Why |
|---|---|---|
| "Also check my spam folder" | Agent prompt (new task step) | Task scope changed |
| "I prefer bullet points" | Memory (communication style) | How you present output |
| "Stop summarizing replies" | Agent prompt (boundary) | What you should NOT do |
| "That summary was too long" | Memory (quality standard) | How to calibrate quality |
| "Run this every morning at 8" | Agent prompt (schedule note) | When/where to deliver |
| "Don't merge Tom entities" | Memory (correction) | Specific learned lesson |
| "Also create tasks for action items" | Agent prompt (output change) | What you produce |
| "Always include the item ID" | Memory (standard) | Format preference |
