---
name: google
description: >
  Google Workspace setup and integration management. Handles MCP connection
  configuration and OAuth authentication. Individual Google tools (Gmail,
  Calendar, Drive, etc.) should be added to relevant skills via update_agent.
  See TOOLS_REFERENCE.md for the complete tool catalog.
allowed-tools:
  - mcp__google_workspace__start_google_auth
---

# google

Google Workspace integration via the `google_workspace` MCP connection.

This skill handles **setup and auth only**. Google tools are distributed to
other skills where they're contextually relevant (e.g. calendar tools in
reminders, email tools in capture). See `TOOLS_REFERENCE.md` for the full
list of available tools to assign to skills.

## Setup

To connect Google Workspace, add an MCP connection using `add_mcp_connection`:

```
name: google_workspace
transport: stdio
command: uvx
args: ["workspace-mcp"]
env: { "GOOGLE_OAUTH_CLIENT_ID": "<id>", "GOOGLE_OAUTH_CLIENT_SECRET": "<secret>" }
```

OAuth credentials are created at https://console.cloud.google.com/apis/credentials
(Desktop application type, no redirect URI needed).

After adding the connection, run `start_google_auth` to complete the OAuth flow.

## Adding Google Tools to Skills

Use `update_agent` to add specific Google tools to relevant skills. Tool names
follow the pattern `mcp__google_workspace__<tool_name>`. Consult
`TOOLS_REFERENCE.md` for the complete catalog organized by service.

Example groupings:
- **recall/capture**: Gmail read, Drive search, Calendar events, Contacts search
- **manage**: Gmail send/draft, Drive create/update, Calendar manage, Tasks manage
- **reminders**: Calendar manage_event
- **daily-digest**: Calendar get_events, Gmail search

## Usage Guidelines

- **Gmail**: `search_gmail_messages` to find, `get_gmail_message_content` to read, `send_gmail_message` to send
- **Calendar**: `get_events` to query, `manage_event` to create/update/delete
- **Drive**: `search_drive_files` to find, `create_drive_file` to upload, `list_drive_items` to browse
- **Docs**: `get_doc_as_markdown` to read, `create_doc` to create, `modify_doc_text` to edit
- **Sheets**: `read_sheet_values` to read, `modify_sheet_values` to write
- **Tasks**: `list_tasks` to view, `manage_task` to create/update/complete
- **Contacts**: `search_contacts` to find, `manage_contact` to create/update
