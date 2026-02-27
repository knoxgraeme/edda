---
name: coding
description: >
  Shell execution skill for running code, scripts, and CLI tools
  in a sandboxed environment.
allowed-tools:
  - execute
allowed-commands:
  - node
  - npx
  - npm
  - git
  - python3
  - pip
  - cat
  - ls
  - head
  - tail
  - jq
  - curl
  - wget
---

# Coding

You have access to a sandboxed shell environment via the `execute` tool.

## When to use execute
- Running scripts you've written via write_file
- Installing packages (npm, pip)
- Running CLI tools (git, jq, curl)
- Building and testing code

## When NOT to use execute
- Reading files — use read_file instead
- Searching files — use grep/glob instead
- Writing files — use write_file instead
- These structured tools are faster and more reliable than shell equivalents

## Important
- The sandbox has no access to environment variables or secrets
- Installed packages are ephemeral (lost when the sandbox stops)
- Prefer structured Edda tools (search_items, create_item, etc.) over shell commands
