# Skill Authoring Guide

How to write custom SKILL.md files for Edda agents.

## Structure

Every SKILL.md has two parts:

1. **YAML frontmatter** — metadata (name, description, allowed-tools)
2. **Markdown body** — workflow instructions the agent follows

## Frontmatter Format

```yaml
---
name: my_skill_name
description: >
  Third-person description with specific trigger phrases.
  "Do X when Y" or "Use when the user wants Z".
allowed-tools:
  - tool_name_1
  - tool_name_2
---
```

### Rules
- `name` must be snake_case, 1-50 chars, start with a letter
- `description` should be third-person ("Manages..." not "Manage...")
- Include trigger phrases in the description ("Use when...", "Triggers on...")
- `allowed-tools` declares the minimum set of tools this skill needs
- Only list tools the skill actually uses (principle of least privilege)

## Body Conventions

### Keep it under 500 lines
SKILL.md is loaded into the agent's context window. Heavy content (templates, catalogs, examples) belongs in `references/` companion files.

### Use imperative instructions
Write as direct instructions to the agent:
- Good: "Search for items matching the user's query"
- Bad: "The agent should search for items"

### Include trigger phrases
Help the agent know when to activate this skill:
```markdown
"summarize my week", "weekly report", "what happened this week?"
```

### Concrete examples over abstract rules
```markdown
### Example
User: "Track my water intake"
→ Create item type "water_intake" with metadata_schema: { amount_ml: "number", time: "string" }
→ NOT: Create a generic "tracker" type
```

### Decision trees for judgment calls
```markdown
### When to create a new item type vs use existing
- User describes a NEW category of thing → create_item_type
- User describes something that fits an existing type → use existing
- Ambiguous → ask the user
```

## Anti-Patterns

1. **Don't duplicate system context** — Rules about approval settings, MCP connections, etc. are already in the system prompt. Don't repeat them.

2. **Don't include memory instructions** — Communication preferences and corrections belong in AGENTS.md, not SKILL.md.

3. **Don't over-scope tools** — If a skill only reads items, don't include `create_item` in allowed-tools.

4. **Don't write implementation code** — Skills are instructions, not code. The agent uses tools to execute.

5. **Don't hard-code user-specific values** — Use references to settings or dynamic lookups instead.

## Companion Files

Put heavy reference content in `references/` alongside SKILL.md:

```
skills/my_skill/
  SKILL.md                      # Workflow (< 500 lines)
  references/templates.md       # Prompt templates, examples
  references/catalog.md         # Lists, catalogs, lookup tables
```

Pass companion files via the `files` parameter when calling `install_skill`:
```
files: { "references/templates.md": "..." }
```

## Installing

Use the `install_skill` tool with the raw SKILL.md content and any companion files. Then assign it to an agent via `update_agent`.
