-- Migration 014: optional pg_cron bootstrap for http_trigger mode.
--
-- Sets up a DB-native cron that pokes Edda's /api/cron/tick endpoint once a
-- minute. The server handles the "is anything actually due?" logic on its
-- end — empty ticks complete in ~100ms and cost next to nothing on
-- scale-to-zero hosts, so we don't try to be clever about skipping them
-- from SQL.
--
-- This migration is a *graceful no-op* on Postgres installations that don't
-- have pg_cron + pg_net available (e.g. Railway managed Postgres, Fly MPG).
-- It logs a NOTICE and exits cleanly — so self-hosted Postgres, Supabase,
-- Neon, RDS, Azure Flexible Server, and Cloud SQL pick it up automatically,
-- while hosts without pg_cron fall back to using Railway Cron Jobs, Fly
-- machine cron, or GitHub Actions to post to the endpoint instead.
--
-- Configuration (set via ALTER DATABASE after the migration runs, or via
-- platform-specific DB parameter groups):
--   edda.cron_endpoint   — full URL of POST /api/cron/tick
--                          (e.g. 'http://edda-server.internal:8000/api/cron/tick')
--   edda.internal_secret — INTERNAL_API_SECRET bearer token
--
-- If either setting is missing, the job is scheduled but no-ops until both
-- are set. No silent failures, no crashes.

DO $$
DECLARE
  has_pg_cron BOOLEAN;
  has_pg_net  BOOLEAN;
BEGIN
  -- pg_cron requires shared_preload_libraries, so installing it from this
  -- migration won't work — we only proceed if it's already available at
  -- the cluster level.
  SELECT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) INTO has_pg_cron;

  IF NOT has_pg_cron THEN
    RAISE NOTICE 'pg_cron not available — skipping DB-native cron setup. Use Railway Cron Jobs, Fly machine cron, or another external scheduler to POST /api/cron/tick. See README "Scheduling architecture".';
    RETURN;
  END IF;

  -- pg_net is needed for the HTTP POST. Supabase and Neon bundle it;
  -- self-hosted installs may need superuser access to CREATE EXTENSION.
  SELECT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net'
  ) INTO has_pg_net;

  IF NOT has_pg_net THEN
    RAISE NOTICE 'pg_cron is available but pg_net is not — cannot make HTTP calls from Postgres. Either install pg_net (`CREATE EXTENSION pg_net`) or use an external scheduler to POST /api/cron/tick.';
    RETURN;
  END IF;

  -- Both extensions are available — make sure they're created in this DB.
  -- CREATE EXTENSION IF NOT EXISTS is idempotent.
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Schedule the tick. Runs every minute; only makes the HTTP call when
  -- both config settings are present. Set them via:
  --   ALTER DATABASE <name> SET edda.cron_endpoint = 'https://.../api/cron/tick';
  --   ALTER DATABASE <name> SET edda.internal_secret = '<secret>';
  PERFORM cron.schedule(
    'edda-cron-tick',
    '* * * * *',
    $job$
    SELECT net.http_post(
      url := current_setting('edda.cron_endpoint', true),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('edda.internal_secret', true),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    )
    WHERE COALESCE(current_setting('edda.cron_endpoint', true), '') <> ''
      AND COALESCE(current_setting('edda.internal_secret', true), '') <> '';
    $job$
  );

  RAISE NOTICE 'pg_cron job "edda-cron-tick" scheduled. Set edda.cron_endpoint and edda.internal_secret via ALTER DATABASE if you haven''t already.';
END
$$;
