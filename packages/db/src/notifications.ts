/**
 * Notifications — CRUD and lifecycle queries for the notifications table.
 */

import { getPool } from "./connection.js";
import type {
  Notification,
  NotificationSourceType,
  NotificationPriority,
} from "./types.js";

const NOTIFICATION_COLS = `id, source_type, source_id, target_type, target_id, summary, detail, priority, status, expires_at, scheduled_at, recurrence, targets, created_at`;

export async function createNotification(input: {
  source_type: NotificationSourceType;
  source_id: string;
  target_type: "inbox" | "agent";
  target_id?: string | null;
  summary: string;
  detail?: Record<string, unknown>;
  priority?: NotificationPriority;
  expires_after?: string | null;
  scheduled_at?: string;
  recurrence?: string;
  targets?: string[];
}): Promise<Notification> {
  const pool = getPool();
  const isScheduled = !!input.scheduled_at;

  // Scheduled reminders get status='scheduled' and no expiry
  const status = isScheduled ? "scheduled" : "unread";

  // Compute expires_at in TypeScript: scheduled → null, explicit null → null, otherwise compute from interval
  let expiresAt: string | null;
  if (isScheduled || input.expires_after === null) {
    expiresAt = null;
  } else {
    // Default 72-hour expiry; custom interval handled via SQL addition
    expiresAt = input.expires_after ?? null;
  }

  // Always use fixed parameter positions $1–$12
  const params: unknown[] = [
    input.source_type, // $1
    input.source_id, // $2
    input.target_type, // $3
    input.target_id ?? null, // $4
    input.summary, // $5
    JSON.stringify(input.detail ?? {}), // $6
    input.priority ?? "normal", // $7
    expiresAt, // $8
    status, // $9
    input.scheduled_at ?? null, // $10
    input.recurrence ?? null, // $11
    input.targets ?? [], // $12
  ];

  // If a custom expires_after interval is provided, use it; otherwise default to 72 hours.
  // Scheduled reminders and explicit null already set expiresAt = null above.
  const expiresExpr =
    expiresAt === null && (isScheduled || input.expires_after === null)
      ? "NULL"
      : "now() + COALESCE($8::interval, interval '72 hours')";

  const { rows } = await pool.query(
    `INSERT INTO notifications (source_type, source_id, target_type, target_id, summary, detail, priority, expires_at, status, scheduled_at, recurrence, targets)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${expiresExpr}, $9, $10, $11, $12)
     RETURNING ${NOTIFICATION_COLS}`,
    params,
  );
  return rows[0] as Notification;
}

/**
 * Get unread, non-expired notifications for a specific agent (passive consumption).
 */
export async function getUnreadNotifications(agentName: string): Promise<Notification[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${NOTIFICATION_COLS} FROM notifications
     WHERE target_type = 'agent' AND target_id = $1
       AND status = 'unread' AND expires_at > now()
     ORDER BY created_at ASC`,
    [agentName],
  );
  return rows as Notification[];
}

/**
 * Atomically claim unread notifications for an agent.
 * Transitions status from 'unread' to 'read' and returns claimed rows.
 * Only one concurrent caller will successfully claim — prevents duplicate triggered runs.
 */
export async function claimUnreadNotifications(agentName: string): Promise<Notification[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE notifications
     SET status = 'read'
     WHERE target_type = 'agent' AND target_id = $1
       AND status = 'unread' AND expires_at > now()
     RETURNING ${NOTIFICATION_COLS}`,
    [agentName],
  );
  return rows as Notification[];
}

/**
 * Get inbox notifications with optional status/limit filters.
 */
export async function getInboxNotifications(opts?: {
  status?: "unread" | "read" | "dismissed";
  limit?: number;
}): Promise<Notification[]> {
  const pool = getPool();
  const conditions = ["target_type = 'inbox'", "expires_at > now()"];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  }

  const limit = opts?.limit ?? 50;
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT ${NOTIFICATION_COLS} FROM notifications
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );
  return rows as Notification[];
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const pool = getPool();
  await pool.query(
    `UPDATE notifications SET status = 'read' WHERE id = ANY($1) AND status = 'unread'`,
    [ids],
  );
}

export async function dismissNotification(id: string): Promise<Notification | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE notifications SET status = 'dismissed'
     WHERE id = $1 AND status IN ('unread', 'read', 'scheduled', 'sending')
     RETURNING ${NOTIFICATION_COLS}`,
    [id],
  );
  return (rows[0] as Notification) ?? null;
}

export async function deleteExpiredNotifications(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM notifications WHERE expires_at < now()`);
  return rowCount ?? 0;
}

// ── Scheduled Reminders ───────────────────────────────────────────────

/**
 * Atomically claim due reminders for processing.
 * Transitions status from 'scheduled' to 'sending' and returns claimed rows.
 */
export async function claimDueReminders(): Promise<Notification[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE notifications
     SET status = 'sending'
     WHERE id IN (
       SELECT id FROM notifications
       WHERE status = 'scheduled' AND scheduled_at <= now()
       ORDER BY scheduled_at ASC
       LIMIT 100
       FOR UPDATE SKIP LOCKED
     )
     RETURNING ${NOTIFICATION_COLS}`,
  );
  return rows as Notification[];
}

/**
 * Advance a recurring reminder to the next cron fire date.
 */
export async function advanceReminderByDate(id: string, nextAt: Date): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE notifications SET scheduled_at = $2, status = 'scheduled' WHERE id = $1`,
    [id, nextAt.toISOString()],
  );
}

/**
 * Advance a recurring reminder by a PostgreSQL interval string.
 */
export async function advanceReminderByInterval(id: string, interval: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE notifications SET scheduled_at = scheduled_at + $2::interval, status = 'scheduled' WHERE id = $1`,
    [id, interval],
  );
}

/**
 * Mark a one-shot reminder as sent (terminal state).
 */
export async function completeReminder(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE notifications SET status = 'sent' WHERE id = $1`, [id]);
}

/**
 * Get upcoming scheduled reminders.
 */
export async function getScheduledReminders(opts?: {
  limit?: number;
}): Promise<Notification[]> {
  const pool = getPool();
  const limit = opts?.limit ?? 50;
  const { rows } = await pool.query(
    `SELECT ${NOTIFICATION_COLS} FROM notifications
     WHERE status = 'scheduled'
     ORDER BY scheduled_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows as Notification[];
}

/**
 * Reset reminders stuck in 'sending' state (older than 5 minutes) back to 'scheduled'.
 * Called on startup to recover from crashes.
 */
export async function resetStuckSendingReminders(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE notifications SET status = 'scheduled'
     WHERE status = 'sending' AND scheduled_at < now() - interval '5 minutes'`,
  );
  return rowCount ?? 0;
}
