/**
 * Notifications — CRUD and lifecycle queries for the notifications table.
 */

import { getPool } from "./connection.js";
import type {
  Notification,
  NotificationSourceType,
  NotificationPriority,
} from "./types.js";

const NOTIFICATION_COLS = `id, source_type, source_id, target_type, target_id, summary, detail, priority, status, expires_at, created_at`;

export async function createNotification(input: {
  source_type: NotificationSourceType;
  source_id: string;
  target_type: "inbox" | "agent";
  target_id?: string | null;
  summary: string;
  detail?: Record<string, unknown>;
  priority?: NotificationPriority;
  expires_after?: string;
}): Promise<Notification> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO notifications (source_type, source_id, target_type, target_id, summary, detail, priority, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + COALESCE($8::interval, interval '72 hours'))
     RETURNING ${NOTIFICATION_COLS}`,
    [
      input.source_type,
      input.source_id,
      input.target_type,
      input.target_id ?? null,
      input.summary,
      JSON.stringify(input.detail ?? {}),
      input.priority ?? "normal",
      input.expires_after ?? null,
    ],
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
     WHERE id = $1 AND status IN ('unread', 'read')
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
