/**
 * Telegram paired users — DB-backed access control for the Telegram bot.
 */

import { getPool } from "./connection.js";
import type { TelegramPairedUser } from "./types.js";

export async function getPairedUser(telegramId: number): Promise<TelegramPairedUser | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, telegram_id, display_name, status, created_at FROM telegram_paired_users WHERE telegram_id = $1",
    [telegramId],
  );
  return (rows[0] as TelegramPairedUser) ?? null;
}

export async function createPairingRequest(
  telegramId: number,
  displayName?: string,
): Promise<TelegramPairedUser> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO telegram_paired_users (telegram_id, display_name)
     VALUES ($1, $2)
     ON CONFLICT (telegram_id) DO NOTHING
     RETURNING id, telegram_id, display_name, status, created_at`,
    [telegramId, displayName ?? null],
  );
  // If ON CONFLICT hit, fetch the existing row
  if (rows.length === 0) {
    const existing = await getPairedUser(telegramId);
    if (!existing) {
      throw new Error(`Pairing conflict: row not found for telegram_id=${telegramId}`);
    }
    return existing;
  }
  return rows[0] as TelegramPairedUser;
}

export async function approvePairing(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "UPDATE telegram_paired_users SET status = 'approved' WHERE id = $1",
    [id],
  );
}

export async function rejectPairing(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "UPDATE telegram_paired_users SET status = 'rejected' WHERE id = $1",
    [id],
  );
}

export async function getPendingPairings(): Promise<TelegramPairedUser[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, telegram_id, display_name, status, created_at FROM telegram_paired_users WHERE status = 'pending' ORDER BY created_at DESC",
  );
  return rows as TelegramPairedUser[];
}
