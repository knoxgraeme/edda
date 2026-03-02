#!/usr/bin/env bash
set -euo pipefail

# ── Edda Fly.io + Neon provisioning script ────────────────────────
# Usage: ./scripts/provision-fly.sh <app-name> [region]
#
# Required env vars:
#   NEON_API_KEY       — Neon API key
#   ANTHROPIC_API_KEY  — Anthropic API key (or other LLM provider key)
#   EDDA_PASSWORD      — Password for the web UI
#
# Optional env vars:
#   OPENAI_API_KEY, GOOGLE_API_KEY, VOYAGEAI_API_KEY

APP_NAME="${1:?Usage: provision-fly.sh <app-name> [region]}"
REGION="${2:-iad}"

# Validate app name (Fly.io naming rules)
if [[ ! "$APP_NAME" =~ ^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$ ]]; then
  echo "Error: App name must be 3-30 lowercase alphanumeric characters or hyphens"
  exit 1
fi

# ── Preflight checks ─────────────────────────────────────────────
command -v flyctl >/dev/null 2>&1 || { echo "Error: flyctl not found. Install: https://fly.io/docs/flyctl/install/"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "Error: curl not found."; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq not found."; exit 1; }

[ -z "${NEON_API_KEY:-}" ] && { echo "Error: NEON_API_KEY is required"; exit 1; }
[ -z "${ANTHROPIC_API_KEY:-}" ] && { echo "Error: ANTHROPIC_API_KEY is required"; exit 1; }
[ -z "${EDDA_PASSWORD:-}" ] && { echo "Error: EDDA_PASSWORD is required"; exit 1; }

echo "==> Creating Neon project: ${APP_NAME}"
NEON_PAYLOAD=$(jq -n --arg name "$APP_NAME" '{"project":{"name":$name,"pg_version":16}}')
NEON_RESPONSE=$(curl -s -X POST "https://console.neon.tech/api/v2/projects" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$NEON_PAYLOAD")

DATABASE_URL=$(echo "$NEON_RESPONSE" | jq -r '.connection_uris[0].connection_uri')
if [ -z "$DATABASE_URL" ] || [ "$DATABASE_URL" = "null" ]; then
  echo "Error: Failed to create Neon project"
  echo "$NEON_RESPONSE" | jq '.message // .error // "Unknown error"'
  exit 1
fi
echo "    Neon project created."

# ── Wait for DB readiness ────────────────────────────────────────
echo "==> Waiting for database readiness..."
for i in $(seq 1 30); do
  if DATABASE_URL="$DATABASE_URL" node -e "
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    p.query('SELECT 1').then(() => { p.end(); process.exit(0); }).catch(() => { p.end(); process.exit(1); });
  " 2>/dev/null; then
    echo "    Database ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: Database not ready after 30 attempts"
    exit 1
  fi
  sleep 2
done

# ── Create Fly app ───────────────────────────────────────────────
echo "==> Creating Fly app: ${APP_NAME} in ${REGION}"
flyctl apps create "${APP_NAME}" --machines 2>/dev/null || echo "    App already exists, continuing..."

# ── Generate secrets ─────────────────────────────────────────────
INTERNAL_API_SECRET=$(openssl rand -hex 32)
EDDA_ENCRYPTION_KEY=$(openssl rand -base64 32)

echo "==> Setting Fly secrets..."
# Pipe secrets via stdin — never logged
{
  echo "DATABASE_URL=${DATABASE_URL}"
  echo "INTERNAL_API_SECRET=${INTERNAL_API_SECRET}"
  echo "EDDA_ENCRYPTION_KEY=${EDDA_ENCRYPTION_KEY}"
  echo "SERVER_URL=http://${APP_NAME}.internal:8000"
  echo "CORS_ORIGIN=https://${APP_NAME}.fly.dev"
  echo "EDDA_BASE_URL=https://${APP_NAME}.fly.dev"
  echo "EDDA_PASSWORD=${EDDA_PASSWORD}"
  echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
  [ -n "${OPENAI_API_KEY:-}" ] && echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
  [ -n "${GOOGLE_API_KEY:-}" ] && echo "GOOGLE_API_KEY=${GOOGLE_API_KEY}"
  [ -n "${VOYAGEAI_API_KEY:-}" ] && echo "VOYAGEAI_API_KEY=${VOYAGEAI_API_KEY}"
} | flyctl secrets import --app "${APP_NAME}"
echo "    Secrets set."

# ── Deploy ───────────────────────────────────────────────────────
echo "==> Deploying to Fly.io..."
flyctl deploy --app "${APP_NAME}" --region "${REGION}"

echo ""
echo "==> Deployment complete!"
echo "    URL: https://${APP_NAME}.fly.dev"
