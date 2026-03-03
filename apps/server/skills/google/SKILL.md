---
name: google
description: >
  Google Workspace integration via MCP. Provides access to Gmail, Calendar,
  Drive, Docs, Sheets, Slides, Forms, Chat, Tasks, Contacts, Apps Script,
  and Custom Search. Requires the google_workspace MCP connection in Settings.
allowed-tools:
  # Auth
  - mcp__google_workspace__start_google_auth
  # Calendar
  - mcp__google_workspace__list_calendars
  - mcp__google_workspace__get_events
  - mcp__google_workspace__manage_event
  # Drive
  - mcp__google_workspace__search_drive_files
  - mcp__google_workspace__get_drive_file_content
  - mcp__google_workspace__get_drive_file_download_url
  - mcp__google_workspace__create_drive_file
  - mcp__google_workspace__create_drive_folder
  - mcp__google_workspace__import_to_google_doc
  - mcp__google_workspace__get_drive_shareable_link
  - mcp__google_workspace__list_drive_items
  - mcp__google_workspace__copy_drive_file
  - mcp__google_workspace__update_drive_file
  - mcp__google_workspace__manage_drive_access
  - mcp__google_workspace__set_drive_file_permissions
  - mcp__google_workspace__get_drive_file_permissions
  - mcp__google_workspace__check_drive_file_public_access
  # Gmail
  - mcp__google_workspace__search_gmail_messages
  - mcp__google_workspace__get_gmail_message_content
  - mcp__google_workspace__get_gmail_messages_content_batch
  - mcp__google_workspace__send_gmail_message
  - mcp__google_workspace__get_gmail_thread_content
  - mcp__google_workspace__modify_gmail_message_labels
  - mcp__google_workspace__list_gmail_labels
  - mcp__google_workspace__list_gmail_filters
  - mcp__google_workspace__manage_gmail_label
  - mcp__google_workspace__manage_gmail_filter
  - mcp__google_workspace__draft_gmail_message
  - mcp__google_workspace__get_gmail_threads_content_batch
  - mcp__google_workspace__batch_modify_gmail_message_labels
  # Docs
  - mcp__google_workspace__get_doc_content
  - mcp__google_workspace__create_doc
  - mcp__google_workspace__modify_doc_text
  - mcp__google_workspace__search_docs
  - mcp__google_workspace__find_and_replace_doc
  - mcp__google_workspace__list_docs_in_folder
  - mcp__google_workspace__insert_doc_elements
  - mcp__google_workspace__update_paragraph_style
  - mcp__google_workspace__get_doc_as_markdown
  - mcp__google_workspace__insert_doc_image
  - mcp__google_workspace__update_doc_headers_footers
  - mcp__google_workspace__batch_update_doc
  - mcp__google_workspace__inspect_doc_structure
  - mcp__google_workspace__export_doc_to_pdf
  - mcp__google_workspace__create_table_with_data
  - mcp__google_workspace__debug_table_structure
  - mcp__google_workspace__list_document_comments
  - mcp__google_workspace__manage_document_comment
  # Sheets
  - mcp__google_workspace__read_sheet_values
  - mcp__google_workspace__modify_sheet_values
  - mcp__google_workspace__create_spreadsheet
  - mcp__google_workspace__list_spreadsheets
  - mcp__google_workspace__get_spreadsheet_info
  - mcp__google_workspace__format_sheet_range
  - mcp__google_workspace__create_sheet
  - mcp__google_workspace__list_spreadsheet_comments
  - mcp__google_workspace__manage_spreadsheet_comment
  - mcp__google_workspace__manage_conditional_formatting
  # Slides
  - mcp__google_workspace__create_presentation
  - mcp__google_workspace__get_presentation
  - mcp__google_workspace__batch_update_presentation
  - mcp__google_workspace__get_page
  - mcp__google_workspace__get_page_thumbnail
  - mcp__google_workspace__list_presentation_comments
  - mcp__google_workspace__manage_presentation_comment
  # Forms
  - mcp__google_workspace__create_form
  - mcp__google_workspace__get_form
  - mcp__google_workspace__set_publish_settings
  - mcp__google_workspace__get_form_response
  - mcp__google_workspace__list_form_responses
  - mcp__google_workspace__batch_update_form
  # Tasks
  - mcp__google_workspace__list_tasks
  - mcp__google_workspace__get_task
  - mcp__google_workspace__manage_task
  - mcp__google_workspace__list_task_lists
  - mcp__google_workspace__get_task_list
  - mcp__google_workspace__manage_task_list
  # Contacts
  - mcp__google_workspace__search_contacts
  - mcp__google_workspace__get_contact
  - mcp__google_workspace__list_contacts
  - mcp__google_workspace__manage_contact
  - mcp__google_workspace__list_contact_groups
  - mcp__google_workspace__get_contact_group
  - mcp__google_workspace__manage_contacts_batch
  - mcp__google_workspace__manage_contact_group
  # Chat
  - mcp__google_workspace__list_spaces
  - mcp__google_workspace__get_messages
  - mcp__google_workspace__send_message
  - mcp__google_workspace__search_messages
  - mcp__google_workspace__create_reaction
  - mcp__google_workspace__download_chat_attachment
  # Custom Search
  - mcp__google_workspace__search_custom
  - mcp__google_workspace__get_search_engine_info
  # Apps Script
  - mcp__google_workspace__list_script_projects
  - mcp__google_workspace__get_script_project
  - mcp__google_workspace__get_script_content
  - mcp__google_workspace__create_script_project
  - mcp__google_workspace__update_script_content
  - mcp__google_workspace__run_script_function
  - mcp__google_workspace__list_deployments
  - mcp__google_workspace__manage_deployment
  - mcp__google_workspace__list_script_processes
---

# google

Google Workspace tools accessed via the `google_workspace` MCP connection.

## Setup

The user must add an MCP connection in Settings > MCP Connections:

- **Name**: `google_workspace`
- **Transport**: stdio
- **Command**: `uvx`
- **Args**: `["workspace-mcp"]`
- **Env**: `{ "GOOGLE_OAUTH_CLIENT_ID": "...", "GOOGLE_OAUTH_CLIENT_SECRET": "..." }`

OAuth credentials are created at https://console.cloud.google.com/apis/credentials
(Desktop application type, no redirect URI needed).

## Usage Guidelines

### Gmail
"check my email", "send an email to...", "what emails did I get today"
→ Use `search_gmail_messages` to find emails, `get_gmail_message_content` to read,
  `send_gmail_message` to send, `draft_gmail_message` to draft.

### Calendar
"what's on my calendar", "schedule a meeting", "when am I free"
→ Use `get_events` to query events, `manage_event` to create/update/delete.

### Drive
"find that document", "upload to drive", "list my recent files"
→ Use `search_drive_files` to find files, `create_drive_file` to upload,
  `list_drive_items` to browse folders.

### Docs
"create a doc", "update the meeting notes doc", "read that document"
→ Use `get_doc_content` or `get_doc_as_markdown` to read, `create_doc` to create,
  `modify_doc_text` to edit.

### Sheets
"update the spreadsheet", "read the budget sheet", "add a row"
→ Use `read_sheet_values` to read, `modify_sheet_values` to write,
  `create_spreadsheet` to create.

### Slides
"create a presentation", "update the deck"
→ Use `create_presentation` to create, `batch_update_presentation` to modify.

### Forms
"create a form", "check form responses"
→ Use `create_form` to create, `list_form_responses` to read responses.

### Tasks
"my tasks", "add a task", "mark task as done"
→ Use `list_tasks` to view, `manage_task` to create/update/complete.

### Contacts
"find John's email", "add a contact", "my contact groups"
→ Use `search_contacts` to find, `manage_contact` to create/update.

### Chat
"send a chat message", "check my chats"
→ Use `send_message` to send, `get_messages` to read, `list_spaces` to browse.

### Custom Search
"search the web for..."
→ Use `search_custom` for web searches via Google Custom Search.

### Apps Script
"run my script", "list my scripts"
→ Use `run_script_function` to execute, `list_script_projects` to browse.
