#!/usr/bin/env bash
set -euo pipefail

# PostToolUse check for Write|Edit|MultiEdit.
# Runs fast grep-based checks on edited files instead of separate LLM prompts.
# Exits 0 (pass) or 2 (block with message to stderr).

if ! command -v jq &>/dev/null; then
  exit 0  # Can't check without jq, don't block edits
fi

INPUT="$(cat)"

FILE_PATH="$(printf '%s' "${INPUT}" | jq -r '
  .tool_result.filePath //
  .tool_result.file_path //
  .tool_input.file_path //
  .tool_input.path //
  .file_path //
  .path //
  ""
' 2>/dev/null)" || exit 0

if [[ -z "${FILE_PATH}" ]] || [[ ! -f "${FILE_PATH}" ]]; then
  exit 0
fi

VIOLATIONS=""

# --- Check 1: Server tools must use @edda/db query functions (no raw SQL) ---
if [[ "${FILE_PATH}" == */apps/server/src/agent/tools/*.ts ]]; then
  # Check for raw SQL patterns (pool.query, client.query, pg query calls)
  if grep -qE '(pool|client)\.(query|connect)\(' "${FILE_PATH}" 2>/dev/null; then
    VIOLATIONS+="RAW SQL IN TOOL: Server tools must use query functions from '@edda/db' instead of raw SQL. Import and use the appropriate query function from packages/db/src/queries/.\n"
  fi

  # Community tools (lazy-loaded from @langchain/community) don't use Zod schemas —
  # they are pre-built StructuredTool classes with their own input validation.
  IS_COMMUNITY_TOOL=false
  if grep -qE 'await import\(.*@langchain/community/tools/' "${FILE_PATH}" 2>/dev/null; then
    IS_COMMUNITY_TOOL=true
  fi

  # Check for Zod schema export (skip for community tool wrappers)
  if [[ "${IS_COMMUNITY_TOOL}" == "false" ]]; then
    if ! grep -qE 'export\s+(const\s+\w+Schema|{[^}]*Schema)' "${FILE_PATH}" 2>/dev/null; then
      if ! grep -qE '^\s*schema:' "${FILE_PATH}" 2>/dev/null; then
        VIOLATIONS+="MISSING SCHEMA: Tool files must export a Zod schema for input validation. Define and export an input schema using z.object({...}).\n"
      fi
    fi
  fi
fi

# --- Check 2: Client components must not import from @edda/db or apps/server ---
if [[ "${FILE_PATH}" == *.ts ]] || [[ "${FILE_PATH}" == *.tsx ]]; then
  if grep -q "^'use client'" "${FILE_PATH}" 2>/dev/null || \
     grep -q '^"use client"' "${FILE_PATH}" 2>/dev/null; then

    if grep -qE "^import\s+.*from\s+['\"]@edda/db" "${FILE_PATH}" 2>/dev/null; then
      VIOLATIONS+="ARCHITECTURE VIOLATION: Client components ('use client') must not import from '@edda/db'. Database access should happen through API routes or server components.\n"
    fi

    if grep -qE "^import\s+.*from\s+['\"](@edda/server|\.\..*apps/server)" "${FILE_PATH}" 2>/dev/null; then
      VIOLATIONS+="ARCHITECTURE VIOLATION: Client components ('use client') must not import from the server package. Use API routes for server communication.\n"
    fi
  fi
fi

# --- Check 3: Migration files are append-only ---
if [[ "${FILE_PATH}" == */packages/db/migrations/*.sql ]]; then
  BASENAME="$(basename "${FILE_PATH}")"
  MIGRATION_NUM="$(echo "${BASENAME}" | grep -oE '^[0-9]+' || true)"

  if [[ -n "${MIGRATION_NUM}" ]]; then
    # Get the highest existing migration number
    MIGRATION_DIR="$(dirname "${FILE_PATH}")"
    LATEST="$(ls "${MIGRATION_DIR}"/*.sql 2>/dev/null | sort | tail -1)"
    LATEST_NUM="$(basename "${LATEST}" | grep -oE '^[0-9]+' || true)"

    # If editing an existing migration that's not the latest, warn
    if [[ -n "${LATEST_NUM}" ]] && [[ "${MIGRATION_NUM}" -lt "${LATEST_NUM}" ]]; then
      VIOLATIONS+="APPEND-ONLY MIGRATION: Modifying existing migration ${BASENAME} is not allowed. Migrations are append-only — create a new migration file with the next sequence number instead.\n"
    fi
  fi
fi

# --- Report ---
if [[ -n "${VIOLATIONS}" ]]; then
  printf "%b" "${VIOLATIONS}" >&2
  exit 2
fi

exit 0
