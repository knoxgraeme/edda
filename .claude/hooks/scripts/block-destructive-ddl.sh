#!/usr/bin/env bash
set -euo pipefail

# PreToolUse: Block destructive DDL in database migrations.
# Checks if the file is a migration AND contains DROP/TRUNCATE statements.
# Blocks with exit 2 so the user must confirm manually.

if ! command -v jq &>/dev/null; then
  exit 0  # Can't check without jq, don't block edits
fi

INPUT="$(cat)"

FILE_PATH="$(printf '%s' "${INPUT}" | jq -r '.tool_input.file_path // .tool_input.path // .file_path // .path // ""' 2>/dev/null)" || exit 0

# Only check migration files
if [[ -z "${FILE_PATH}" ]] || [[ "${FILE_PATH}" != */packages/db/migrations/*.sql ]]; then
  exit 0
fi

# Check the content being written (from tool input, not the file on disk)
CONTENT="$(printf '%s' "${INPUT}" | jq -r '.tool_input.content // .tool_input.new_string // ""' 2>/dev/null)" || exit 0

if [[ -z "${CONTENT}" ]]; then
  exit 0
fi

# Scan for destructive DDL
DESTRUCTIVE=""

if echo "${CONTENT}" | grep -qiE '\bDROP\s+TABLE\b'; then
  TABLE="$(echo "${CONTENT}" | grep -ioE 'DROP\s+TABLE\s+(IF\s+EXISTS\s+)?[a-zA-Z_][a-zA-Z0-9_.]*' | head -1)"
  DESTRUCTIVE+="  - ${TABLE}\n"
fi

if echo "${CONTENT}" | grep -qiE '\bDROP\s+COLUMN\b'; then
  COLUMN="$(echo "${CONTENT}" | grep -ioE 'DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?[a-zA-Z_][a-zA-Z0-9_]*' | head -1)"
  DESTRUCTIVE+="  - ${COLUMN}\n"
fi

if echo "${CONTENT}" | grep -qiE '\bDROP\s+CONSTRAINT\b'; then
  CONSTRAINT="$(echo "${CONTENT}" | grep -ioE 'DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?[a-zA-Z_][a-zA-Z0-9_]*' | head -1)"
  DESTRUCTIVE+="  - ${CONSTRAINT}\n"
fi

if echo "${CONTENT}" | grep -qiE '\bTRUNCATE\b'; then
  TRUNCATE="$(echo "${CONTENT}" | grep -ioE 'TRUNCATE\s+(TABLE\s+)?[a-zA-Z_][a-zA-Z0-9_.]*' | head -1)"
  DESTRUCTIVE+="  - ${TRUNCATE}\n"
fi

if [[ -n "${DESTRUCTIVE}" ]]; then
  printf "DESTRUCTIVE MIGRATION BLOCKED: This migration contains destructive DDL that cannot be rolled back once applied to production:\n%b\nApply this migration manually after review.\n" "${DESTRUCTIVE}" >&2
  exit 2
fi

exit 0
