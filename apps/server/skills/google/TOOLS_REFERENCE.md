# Google Workspace MCP — Available Tools

Complete list of tools provided by the `google_workspace` MCP connection.
Use this reference when distributing Google tools to other skills via `update_agent`.

All tool names are prefixed with `mcp__google_workspace__`.

## Auth
- `start_google_auth` — Initiate Google OAuth flow

## Calendar
- `list_calendars` — List available calendars
- `get_events` — Query calendar events
- `manage_event` — Create, update, or delete events

## Gmail
- `search_gmail_messages` — Search emails
- `get_gmail_message_content` — Read a single email
- `get_gmail_messages_content_batch` — Read multiple emails
- `send_gmail_message` — Send an email
- `draft_gmail_message` — Create a draft
- `get_gmail_thread_content` — Read an email thread
- `get_gmail_threads_content_batch` — Read multiple threads
- `modify_gmail_message_labels` — Add/remove labels on a message
- `batch_modify_gmail_message_labels` — Bulk label changes
- `list_gmail_labels` — List all labels
- `list_gmail_filters` — List all filters
- `manage_gmail_label` — Create/update/delete labels
- `manage_gmail_filter` — Create/update/delete filters

## Drive
- `search_drive_files` — Search files
- `get_drive_file_content` — Read file content
- `get_drive_file_download_url` — Get download URL
- `create_drive_file` — Upload/create a file
- `create_drive_folder` — Create a folder
- `import_to_google_doc` — Import a file as Google Doc
- `get_drive_shareable_link` — Get shareable link
- `list_drive_items` — Browse folder contents
- `copy_drive_file` — Copy a file
- `update_drive_file` — Update file content/metadata
- `manage_drive_access` — Manage sharing settings
- `set_drive_file_permissions` — Set permissions
- `get_drive_file_permissions` — Get permissions
- `check_drive_file_public_access` — Check public access

## Docs
- `get_doc_content` — Read document content
- `get_doc_as_markdown` — Read document as markdown
- `create_doc` — Create a new document
- `modify_doc_text` — Edit document text
- `search_docs` — Search documents
- `find_and_replace_doc` — Find and replace in doc
- `list_docs_in_folder` — List docs in a folder
- `insert_doc_elements` — Insert elements (tables, images, etc.)
- `update_paragraph_style` — Update paragraph styling
- `insert_doc_image` — Insert an image
- `update_doc_headers_footers` — Update headers/footers
- `batch_update_doc` — Batch document updates
- `inspect_doc_structure` — Inspect document structure
- `export_doc_to_pdf` — Export as PDF
- `create_table_with_data` — Create a table with data
- `debug_table_structure` — Debug table structure
- `list_document_comments` — List comments
- `manage_document_comment` — Add/resolve comments

## Sheets
- `read_sheet_values` — Read cell values
- `modify_sheet_values` — Write cell values
- `create_spreadsheet` — Create a spreadsheet
- `list_spreadsheets` — List spreadsheets
- `get_spreadsheet_info` — Get spreadsheet metadata
- `format_sheet_range` — Format cells
- `create_sheet` — Add a new sheet/tab
- `list_spreadsheet_comments` — List comments
- `manage_spreadsheet_comment` — Add/resolve comments
- `manage_conditional_formatting` — Manage conditional formatting rules

## Slides
- `create_presentation` — Create a presentation
- `get_presentation` — Read presentation
- `batch_update_presentation` — Modify slides
- `get_page` — Get a single slide
- `get_page_thumbnail` — Get slide thumbnail
- `list_presentation_comments` — List comments
- `manage_presentation_comment` — Add/resolve comments

## Forms
- `create_form` — Create a form
- `get_form` — Read form structure
- `set_publish_settings` — Configure form settings
- `get_form_response` — Read a single response
- `list_form_responses` — List all responses
- `batch_update_form` — Modify form questions

## Tasks
- `list_tasks` — List tasks
- `get_task` — Read a task
- `manage_task` — Create/update/complete tasks
- `list_task_lists` — List task lists
- `get_task_list` — Read a task list
- `manage_task_list` — Create/update/delete task lists

## Contacts
- `search_contacts` — Search contacts
- `get_contact` — Read a contact
- `list_contacts` — List all contacts
- `manage_contact` — Create/update/delete contacts
- `list_contact_groups` — List contact groups
- `get_contact_group` — Read a contact group
- `manage_contacts_batch` — Bulk contact operations
- `manage_contact_group` — Create/update/delete groups

## Chat
- `list_spaces` — List chat spaces
- `get_messages` — Read messages
- `send_message` — Send a message
- `search_messages` — Search messages
- `create_reaction` — React to a message
- `download_chat_attachment` — Download an attachment

## Custom Search
- `search_custom` — Web search via Google Custom Search
- `get_search_engine_info` — Get search engine config

## Apps Script
- `list_script_projects` — List script projects
- `get_script_project` — Read a project
- `get_script_content` — Read script code
- `create_script_project` — Create a project
- `update_script_content` — Update script code
- `run_script_function` — Execute a function
- `list_deployments` — List deployments
- `manage_deployment` — Create/update deployments
- `list_script_processes` — List running processes
