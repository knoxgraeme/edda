---
name: skill_management
description: >
  Discover, install, and manage agent skills from the skillfish registry.
  Uses the skillfish CLI for search/download and persists skills to the database.
allowed-tools:
  - execute
  - install_skill
  - update_agent
  - list_agents
allowed-commands:
  - npx
---

# skill_management

## Workflow

### 1. Search for skills

```
execute("npx skillfish search '<query>' --json")
```

Returns matching skills from the skillfish registry (mcpmarket.com).

### 2. Download a skill (without installing to disk)

```
execute("npx skillfish add owner/repo --json --no-install")
```

Downloads the skill from GitHub and outputs JSON content to stdout:

```json
{
  "success": true,
  "skills": [{
    "name": "skill_name",
    "content": "---\nname: ...\n---\n# Skill content...",
    "files": { "references/example.md": "file content..." }
  }]
}
```

For multi-skill repos, specify the skill name:

```
execute("npx skillfish add owner/repo skill-name --json --no-install")
```

### 3. Install to database

```
install_skill({ content: "<SKILL.md content>", files: { ... } })
```

Parses frontmatter, validates, and inserts into the skills table. Returns the
installed skill name and version.

- System skills cannot be overwritten.
- If a user skill with the same name exists, the name is auto-suffixed (`_2`, `_3`, etc.).
- The actual name used is returned in the response — use it for assignment.

### 4. Assign to an agent

Installing a skill does NOT automatically grant any agent access. Use `list_agents`
to find the target agent, then `update_agent` to add the skill:

```
update_agent({ name: "edda", skills: ["existing_skill", "new_skill"] })
```

## Handling large skills

If the `execute` output is truncated (very large skills), redirect to a file:

```
execute("npx skillfish add owner/repo --json --no-install > /tmp/skill.json")
```

Then read `/tmp/skill.json` from the VFS to get the full content.

## Notes

- Only `npx skillfish` commands should be run via `execute`.
- Skills are isolated — installing one does not affect any agent until explicitly assigned.
- The `--no-install` flag is required to get JSON content output instead of writing to disk.
