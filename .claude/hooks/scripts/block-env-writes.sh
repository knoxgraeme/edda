#!/usr/bin/env bash
set -euo pipefail

# P0 Security: Block writes to .env files and credential files.
# Runs on PreToolUse for Write|Edit|MultiEdit.
# Reads tool input JSON from stdin, checks file_path against blocked patterns.
# FAIL-CLOSED: if we can't parse input, we block the operation.

if ! command -v jq &>/dev/null; then
  echo "Hook error: jq is required but not installed. Blocking write for safety." >&2
  exit 2
fi

INPUT="$(cat)"

FILE_PATH="$(printf '%s' "${INPUT}" | jq -r '.tool_input.file_path // .tool_input.path // .file_path // .path // ""' 2>/dev/null)" || {
  echo "Hook error: failed to parse tool input JSON. Blocking write for safety." >&2
  exit 2
}

if [[ -z "${FILE_PATH}" ]]; then
  # No file path in input — not a file write tool call, allow through
  exit 0
fi

BASENAME="$(basename "${FILE_PATH}")"

BLOCKED=0
REASON=""

# Block .env files (but not .env.example, .env.sample, .env.template)
if [[ "${BASENAME}" == ".env" ]] || \
   [[ "${BASENAME}" == .env.* && "${BASENAME}" != *.example && "${BASENAME}" != *.sample && "${BASENAME}" != *.template ]]; then
  BLOCKED=1
  REASON="Writing to .env files is blocked to prevent accidental credential exposure. Edit .env files manually outside Claude Code."
fi

# Block .envrc (direnv secrets)
if [[ "${BASENAME}" == ".envrc" ]]; then
  BLOCKED=1
  REASON="Writing to .envrc is blocked to prevent accidental credential exposure."
fi

# Block credential/key files
case "${BASENAME}" in
  *.pem|*.key|*.p12|credentials.json|.netrc)
    BLOCKED=1
    REASON="Writing to credential files is blocked to prevent secret exposure."
    ;;
esac

if [[ "${BLOCKED}" -eq 1 ]]; then
  echo "${REASON}" >&2
  exit 2
fi

exit 0
