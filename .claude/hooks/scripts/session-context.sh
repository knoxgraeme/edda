#!/usr/bin/env bash
set -euo pipefail

# SessionStart: Load Edda monorepo context for the agent.
# Emits recent commits, migration state, tool inventory, and skeleton files.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../" && pwd)"

if [[ ! -f "${REPO_ROOT}/pnpm-workspace.yaml" ]]; then
  exit 0
fi

echo "=== Edda Monorepo Session Context ==="
echo ""

# Recent commits
echo "-- Recent Commits --"
git -C "${REPO_ROOT}" log --oneline -5 2>/dev/null || true
echo ""

# Migration list
echo "-- Database Migrations --"
if [[ -d "${REPO_ROOT}/packages/db/migrations" ]]; then
  ls -1 "${REPO_ROOT}/packages/db/migrations/"*.sql 2>/dev/null | while IFS= read -r f; do
    echo "  $(basename "${f}")"
  done
else
  echo "  (no migrations directory)"
fi
echo ""

# Agent tool inventory
echo "-- Agent Tools --"
TOOLS_DIR="${REPO_ROOT}/apps/server/src/agent/tools"
if [[ -d "${TOOLS_DIR}" ]]; then
  TOOL_COUNT="$(find "${TOOLS_DIR}" -name "*.ts" -not -name "index.ts" -not -name "*.test.ts" 2>/dev/null | wc -l | tr -d ' ')"
  echo "  ${TOOL_COUNT} tool files:"
  find "${TOOLS_DIR}" -name "*.ts" -not -name "index.ts" -not -name "*.test.ts" 2>/dev/null \
    | sort \
    | while IFS= read -r tool_file; do
        echo "    $(basename "${tool_file}" .ts)"
      done
else
  echo "  (no tools directory)"
fi
echo ""

# Skills inventory
echo "-- Skills --"
SKILLS_DIR="${REPO_ROOT}/apps/server/skills"
if [[ -d "${SKILLS_DIR}" ]]; then
  find "${SKILLS_DIR}" -maxdepth 1 -type d -not -path "${SKILLS_DIR}" 2>/dev/null \
    | sort \
    | while IFS= read -r skill_dir; do
        echo "  $(basename "${skill_dir}")"
      done
else
  echo "  (no skills directory)"
fi
echo ""

# Skeleton files (files with TODO or skeleton markers)
echo "-- Skeleton / TODO Files --"
SKELETON_COUNT=0
while IFS= read -r skel_file; do
  echo "  ${skel_file#"${REPO_ROOT}/"}"
  SKELETON_COUNT=$((SKELETON_COUNT + 1))
done < <(grep -rl 'TODO\|SKELETON\|PLACEHOLDER\|NOT YET IMPLEMENTED' \
  "${REPO_ROOT}/apps" "${REPO_ROOT}/packages" \
  --include="*.ts" --include="*.tsx" 2>/dev/null | head -20)

if [[ "${SKELETON_COUNT}" -eq 0 ]]; then
  echo "  None found."
fi
echo ""

echo "=== End Session Context ==="
exit 0
