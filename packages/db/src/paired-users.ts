/**
 * Paired users — DB-backed access control for external channel adapters.
 *
 * Platform-agnostic generalization of the Telegram-specific pairing system.
 */

import { getPool } from "./connection.js";
import type { PairedUser } from "./types.js";

export async function checkPlatformUser(
  platform: string,
  platformUserId: string,
): Promise<PairedUser | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, platform, platform_user_id, display_name, status, created_at, updated_at
     FROM paired_users
     WHERE platform = $1 AND platform_user_id = $2`,
    [platform, platformUserId],
  );
  return (rows[0] as PairedUser) ?? null;
}

export async function requestPlatformPairing(
  platform: string,
  platformUserId: string,
  displayName?: string,
): Promise<PairedUser> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO paired_users (platform, platform_user_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (platform, platform_user_id) DO NOTHING
     RETURNING id, platform, platform_user_id, display_name, status, created_at, updated_at`,
    [platform, platformUserId, displayName ?? null],
  );
  // If ON CONFLICT hit, fetch the existing row
  if (rows.length === 0) {
    const existing = await checkPlatformUser(platform, platformUserId);
    if (!existing) {
      throw new Error(
        `Pairing conflict: row not found for ${platform}:${platformUserId}`,
      );
    }
    return existing;
  }
  return rows[0] as PairedUser;
}

export async function approvePlatformUser(
  platform: string,
  platformUserId: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE paired_users SET status = 'approved', updated_at = now()
     WHERE platform = $1 AND platform_user_id = $2`,
    [platform, platformUserId],
  );
}

export async function rejectPlatformUser(
  platform: string,
  platformUserId: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE paired_users SET status = 'rejected', updated_at = now()
     WHERE platform = $1 AND platform_user_id = $2`,
    [platform, platformUserId],
  );
}

export async function getPendingPlatformPairings(
  platform?: string,
): Promise<PairedUser[]> {
  const pool = getPool();
  if (platform) {
    const { rows } = await pool.query(
      `SELECT id, platform, platform_user_id, display_name, status, created_at, updated_at
       FROM paired_users
       WHERE status = 'pending' AND platform = $1
       ORDER BY created_at DESC`,
      [platform],
    );
    return rows as PairedUser[];
  }
  const { rows } = await pool.query(
    `SELECT id, platform, platform_user_id, display_name, status, created_at, updated_at
     FROM paired_users
     WHERE status = 'pending'
     ORDER BY created_at DESC`,
  );
  return rows as PairedUser[];
}
