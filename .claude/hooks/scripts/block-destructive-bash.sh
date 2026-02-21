#!/usr/bin/env bash
set -euo pipefail

# P0 Security: Block destructive Bash commands.
# Runs on PreToolUse for Bash.
# Reads tool input JSON from stdin, checks command against blocked patterns.
# FAIL-CLOSED: if we can't parse input, we block the operation.
# Scans the FULL command string for blocked patterns (catches chained commands).

if ! command -v jq &>/dev/null; then
  echo "Hook error: jq is required but not installed. Blocking command for safety." >&2
  exit 2
fi

INPUT="$(cat)"

COMMAND="$(printf '%s' "${INPUT}" | jq -r '.tool_input.command // .command // ""' 2>/dev/null)" || {
  echo "Hook error: failed to parse tool input JSON. Blocking command for safety." >&2
  exit 2
}

if [[ -z "${COMMAND}" ]]; then
  exit 0
fi

block() {
  echo "$1" >&2
  exit 2
}

# --- Pattern 1: rm with recursive+force flags ---
if echo "${COMMAND}" | grep -qE '\brm\s+' ; then
  has_rm_rf=0
  echo "${COMMAND}" | grep -qE '\brm\s+-[a-zA-Z]*r[a-zA-Z]*f' && has_rm_rf=1
  echo "${COMMAND}" | grep -qE '\brm\s+-[a-zA-Z]*f[a-zA-Z]*r' && has_rm_rf=1
  echo "${COMMAND}" | grep -qE '\brm\s+(-[a-zA-Z]*\s+)*-r\s+(-[a-zA-Z]*\s+)*-f' && has_rm_rf=1
  echo "${COMMAND}" | grep -qE '\brm\s+(-[a-zA-Z]*\s+)*-f\s+(-[a-zA-Z]*\s+)*-r' && has_rm_rf=1
  echo "${COMMAND}" | grep -qE '\brm\s+--recursive' && has_rm_rf=1
  echo "${COMMAND}" | grep -qE '\brm\s+--force' && has_rm_rf=1

  if [[ "${has_rm_rf}" -eq 1 ]]; then
    if echo "${COMMAND}" | grep -qE '&&|;|\|\|'; then
      block "rm -rf in a chained command is blocked. Run destructive commands individually so they can be reviewed."
    fi

    TARGET="$(echo "${COMMAND}" | awk '{print $NF}')"
    TARGET_BASE="$(basename "${TARGET}" 2>/dev/null || echo "${TARGET}")"

    if echo "${TARGET}" | grep -qF '..'; then
      block "rm -rf with path traversal (..) is blocked. Verify the target path manually."
    fi

    case "${TARGET_BASE}" in
      .next|node_modules|dist|build|coverage|.turbo|tmp|temp)
        ;; # Safe build artifact, allow
      *)
        block "rm -rf on potentially important directories is blocked. Verify the target path manually before running."
        ;;
    esac
  fi
fi

# --- Pattern 2: git push --force (but NOT --force-with-lease) ---
if echo "${COMMAND}" | grep -qE '\bgit\s+push\b'; then
  if echo "${COMMAND}" | grep -qE '\-\-force-with-lease'; then
    : # Allow --force-with-lease
  elif echo "${COMMAND}" | grep -qE '(\s--force(\s|$)|\s-f(\s|$))'; then
    block "Force push is blocked. Use git push --force-with-lease if needed, and never force push to main."
  fi
fi

# --- Pattern 3: git reset --hard ---
if echo "${COMMAND}" | grep -qE '\bgit\s+reset\s+--hard'; then
  block "git reset --hard is blocked to prevent losing uncommitted work. Use git stash or git restore instead."
fi

# --- Pattern 4: git clean (any flags) ---
if echo "${COMMAND}" | grep -qE '\bgit\s+clean\b'; then
  block "git clean is blocked to prevent deleting untracked files. Run this manually after review."
fi

# --- Pattern 5: git checkout . or git restore . (discard all changes) ---
if echo "${COMMAND}" | grep -qE '\bgit\s+(checkout|restore)\s+\.\s*$'; then
  block "Discarding all working tree changes is blocked. Use git stash or restore specific files."
fi

# --- Pattern 6: git branch -D (force delete) ---
if echo "${COMMAND}" | grep -qE '\bgit\s+branch\s+-D\b'; then
  block "Force-deleting branches is blocked. Use git branch -d for safe deletion."
fi

# --- Pattern 7: DROP DATABASE or DROP SCHEMA ---
if echo "${COMMAND}" | grep -qiE '\bDROP\s+(DATABASE|SCHEMA)\b'; then
  block "DROP DATABASE/SCHEMA is blocked. Use migrations in packages/db/migrations/ for schema changes."
fi

# --- Pattern 8: TRUNCATE ---
if echo "${COMMAND}" | grep -qiE '\bTRUNCATE\b'; then
  block "TRUNCATE is blocked. Use migrations in packages/db/migrations/ for data operations."
fi

# --- Pattern 9: Direct migration execution ---
if echo "${COMMAND}" | grep -qE '\bpsql\b.*packages/db/migrations/'; then
  block "Directly running migration files is blocked. Use pnpm migrate to apply migrations."
fi

# --- Pattern 10: Writing to .env files via shell redirection ---
if echo "${COMMAND}" | grep -qE '>\s*[^ ]*\.env($|\s|\.)'; then
  block "Writing to .env files via shell is blocked. Edit .env files manually outside Claude Code."
fi

exit 0
