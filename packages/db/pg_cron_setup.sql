-- Optional: DB-native cron for Edda's http_trigger mode.
--
-- This script is NOT part of the migration sequence — it is intended to be
-- run manually, once, against a Postgres instance that supports both
-- `pg_cron` and `pg_net`. Safe to re-run; `cron.schedule()` with the same
-- job name replaces the existing entry, and `CREATE EXTENSION IF NOT EXISTS`
-- is idempotent.
--
-- Why this is a script and not a migration:
--   * `CREATE EXTENSION pg_cron` requires superuser on most managed hosts
--     (RDS, Azure, Cloud SQL). Edda's migration runner does not assume a
--     superuser role.
--   * pg_cron also requires `shared_preload_libraries = 'pg_cron'` at the
--     cluster level, which must already be set before you run this script.
--   * Migrations are one-shot; if you enable pg_cron AFTER migrations have
--     been applied, a migration-based setup would silently never run. A
--     standalone re-runnable script avoids that whole problem.
--
-- Supported hosts:
--   * Self-hosted Postgres with the pg_cron + pg_net packages installed
--   * Supabase (both extensions bundled)
--   * Neon (both bundled on recent plans)
--   * AWS RDS / Aurora (enable pg_cron in the parameter group, run as
--     `rds_superuser`)
--   * Azure Database for PostgreSQL Flexible Server (enable in server
--     parameters, run as a member of `azure_pg_admin`)
--   * Google Cloud SQL for PostgreSQL (enable the pg_cron flag)
--
-- Unsupported hosts fall back to an external scheduler — Railway Cron Jobs,
-- GitHub Actions cron, Fly machine cron, Cloud Scheduler, etc. — pointing
-- at `POST /api/cron/tick`.
--
-- ─── Prerequisites ──────────────────────────────────────────────────
--
-- 1. `shared_preload_libraries` already includes `pg_cron` at the cluster
--    level. This is a server config, not a per-database setting. Check:
--      SHOW shared_preload_libraries;
--    If missing, add it via your host's parameter group and restart.
--
-- 2. You are connected as a role with permission to `CREATE EXTENSION`
--    and `cron.schedule`. On RDS that means `rds_superuser`; on Azure
--    that means `azure_pg_admin`; on self-hosted that usually means the
--    Postgres superuser.
--
-- 3. Set these once on the database Edda uses (replace the placeholders):
--
--      ALTER DATABASE <your-edda-db> SET edda.cron_endpoint   = 'https://<your-server>/api/cron/tick';
--      ALTER DATABASE <your-edda-db> SET edda.internal_secret = '<INTERNAL_API_SECRET>';
--
--    The cron job reads these via `current_setting('edda.cron_endpoint', true)`
--    at run time, so you can update them later without re-running this
--    script.
--
-- 4. In Edda's web UI (or via SQL): flip `settings.cron_runner` to
--    `http_trigger` so the server stops running its own in-process timer.
--
-- ─── Setup ──────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: re-running this script just replaces the job. Unschedule
-- first to keep the operation's intent explicit and avoid surprise
-- accumulation of duplicate jobs with different definitions across
-- pg_cron versions.
SELECT cron.unschedule('edda-cron-tick')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'edda-cron-tick'
);

SELECT cron.schedule(
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

-- ─── Verification ───────────────────────────────────────────────────
--
-- After running this script you can check the job exists:
--   SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'edda-cron-tick';
--
-- And view recent runs:
--   SELECT * FROM cron.job_run_details WHERE jobid = (
--     SELECT jobid FROM cron.job WHERE jobname = 'edda-cron-tick'
--   ) ORDER BY start_time DESC LIMIT 20;
--
-- ─── Teardown ───────────────────────────────────────────────────────
--
-- To remove the job without dropping the extensions:
--   SELECT cron.unschedule('edda-cron-tick');
