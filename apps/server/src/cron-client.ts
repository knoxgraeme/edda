/**
 * cron-client — standalone entry point for external cron triggers.
 *
 * Posts to `${SERVER_URL}/api/cron/tick` with the INTERNAL_API_SECRET
 * bearer token, logs the result, and exits. Designed to be the start
 * command for a Railway Cron Job (or any platform cron primitive that
 * runs a short-lived container on a schedule).
 *
 * Usage:
 *   SERVER_URL=http://my-edda-server:8000 \
 *   INTERNAL_API_SECRET=... \
 *     node apps/server/dist/cron-client.js
 *
 * Exit codes:
 *   0 — tick succeeded (HTTP 200)
 *   1 — tick failed (network error, non-200, or missing env)
 */

const serverUrl = process.env.SERVER_URL ?? "http://localhost:8000";
const secret = process.env.INTERNAL_API_SECRET;

if (!secret) {
  console.error("cron-client: INTERNAL_API_SECRET is required");
  process.exit(1);
}

const endpoint = `${serverUrl.replace(/\/$/, "")}/api/cron/tick`;

async function main() {
  const started = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: "{}",
    });

    const elapsed = Date.now() - started;
    const body = await res.text();

    if (!res.ok) {
      console.error(
        `cron-client: tick failed [${res.status}] after ${elapsed}ms: ${body}`,
      );
      process.exit(1);
    }

    try {
      const parsed = JSON.parse(body) as {
        remindersFired?: number;
        schedulesFired?: number;
        durationMs?: number;
      };
      console.log(
        `cron-client: ok (remindersFired=${parsed.remindersFired ?? 0}, schedulesFired=${parsed.schedulesFired ?? 0}, serverMs=${parsed.durationMs ?? "?"}, clientMs=${elapsed})`,
      );
    } catch {
      // Server returned 200 but unexpected body — still a success.
      console.log(`cron-client: ok (clientMs=${elapsed})`);
    }
  } catch (err) {
    const elapsed = Date.now() - started;
    console.error(
      `cron-client: tick failed after ${elapsed}ms: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

main();
