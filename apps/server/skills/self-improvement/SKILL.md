---
name: self-improvement
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

# self-improvement

## Learning from Interactions

One of your MAIN PRIORITIES is to learn from interactions with the user.
Learnings can be implicit or explicit.

- When you need to remember something, updating memory must be your FIRST,
  IMMEDIATE action — before responding, before calling other tools.
- When the user says something is better/worse, capture WHY and encode it
  as a pattern. Look for the underlying principle, not just the specific mistake.
- Each correction is a chance to improve permanently — don't just fix the
  immediate issue, update your operating notes.
- The user might not explicitly ask you to remember something. If they provide
  information useful for future interactions, update immediately.

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

- User explicitly asks you to remember something
- User describes how you should behave or what they prefer
- User gives feedback on your work — capture what was wrong and how to improve
- You discover patterns or preferences (communication style, format preferences, workflows)
- User corrects you — save the correction AND the underlying principle

### When NOT to Update Memory

- Transient information ("I'm running late", "I'm on my phone")
- One-time task requests ("find me a recipe", "what's the weather?")
- Simple questions, small talk, acknowledgments
- Factual information about the user (preferences, facts, entities) — these
  belong as items in the database, not in memory. Use create_item instead.
- Never store API keys, passwords, or credentials

## Memory vs Items vs Lists — What Goes Where

- **Memory (AGENTS.md)**: How to serve this user — communication style, quality
  standards, corrections, behavioral patterns. Operating notes that shape every
  interaction.
- **Items (create_item)**: What the user knows/wants/has — facts, preferences,
  tasks, recommendations, entities. Granular knowledge searchable via
  search_items.
- **Lists (create_list + create_item)**: Grouped items the user wants to track
  together — reading lists, grocery lists, project tasks. Use lists when the
  user describes a collection of related things.

### Examples

User: "I prefer bullet points over paragraphs"
→ Update memory (communication style that shapes all future responses)

User: "I love Thai food, especially pad see ew"
→ Create item (preference/learned_fact — searchable for future recommendations)

User: "Here are the movies I want to watch: Inception, Interstellar, Arrival"
→ Create list "Movies to Watch" + create items for each movie

User: "That summary was way too long, keep it to 3 bullets max"
→ Update memory (quality standard + correction: "Summaries: 3 bullets max")

User: "Remember that Tom's birthday is March 15"
→ Create item (fact about an entity — searchable, linked to Tom)

User: "Actually don't auto-archive things, always ask me first"
→ Update memory (correction: explicit boundary about agent behavior)

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

## Interrupt Preferences

When the user tells you to stop/start asking for confirmation on a specific action,
update interrupt_overrides via update_agent:
- "always": always ask before executing
- "never": execute without asking
- "suggest": use your judgment

Example: User says "stop asking me before deleting items"
→ `update_agent(name="edda", metadata={ interrupt_overrides: { delete_item: "never" } })`

Example: User says "always confirm before creating new types"
→ `update_agent(name="edda", metadata={ interrupt_overrides: { create_item_type: "always" } })`
