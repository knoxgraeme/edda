#!/usr/bin/env bash
set -euo pipefail

# P2 Quality: Run TypeScript type check when agent finishes.
# Non-blocking — warns on failure but exits 0.
# Guards against infinite Stop hook loops via stop_hook_active.

INPUT="$(cat)"

# Prevent infinite loop: if Stop hook already triggered a continuation, let Claude stop
if command -v jq &>/dev/null; then
  STOP_ACTIVE="$(printf '%s' "${INPUT}" | jq -r '.stop_hook_active // "false"' 2>/dev/null)" || STOP_ACTIVE="false"
  if [[ "${STOP_ACTIVE}" == "true" ]]; then
    exit 0
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../" && pwd)"

if [[ ! -f "${REPO_ROOT}/pnpm-workspace.yaml" ]]; then
  exit 0
fi

printf 'Running TypeScript type check before session end...\n'

if ! timeout 60 pnpm --dir "${REPO_ROOT}" type-check 2>&1; then
  printf '\nWARNING: TypeScript type check failed. Review type errors before committing.\n'
  printf 'Run: pnpm type-check\n'
  exit 0
fi

printf 'TypeScript type check passed.\n'
exit 0
