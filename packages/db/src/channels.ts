/**
 * Agent channels CRUD
 *
 * Platform-agnostic channel links for bidirectional chat routing
 * and proactive announcement delivery.
 */

import { getPool } from "./connection.js";
import type { AgentChannel, ChannelPlatform } from "./types.js";

const CHANNEL_COLS = `id, agent_id, platform, external_id, config, enabled, receive_announcements, created_at`;

export async function createChannel(input: {
  agent_id: string;
  platform: ChannelPlatform;
  external_id: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  receive_announcements?: boolean;
}): Promise<AgentChannel> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agent_channels (agent_id, platform, external_id, config, enabled, receive_announcements)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${CHANNEL_COLS}`,
    [
      input.agent_id,
      input.platform,
      input.external_id,
      JSON.stringify(input.config ?? {}),
      input.enabled ?? true,
      input.receive_announcements ?? false,
    ],
  );
  return rows[0] as AgentChannel;
}

export async function getChannelByExternalId(
  platform: ChannelPlatform,
  externalId: string,
): Promise<AgentChannel | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${CHANNEL_COLS} FROM agent_channels
     WHERE platform = $1 AND external_id = $2 AND enabled = true`,
    [platform, externalId],
  );
  return (rows[0] as AgentChannel) ?? null;
}

export async function getChannelsByAgent(
  agentId: string,
  opts?: { receiveAnnouncements?: boolean; platform?: ChannelPlatform },
): Promise<AgentChannel[]> {
  const pool = getPool();
  const conditions = ["agent_id = $1", "enabled = true"];
  const params: unknown[] = [agentId];
  let idx = 2;

  if (opts?.receiveAnnouncements !== undefined) {
    conditions.push(`receive_announcements = $${idx++}`);
    params.push(opts.receiveAnnouncements);
  }
  if (opts?.platform) {
    conditions.push(`platform = $${idx++}`);
    params.push(opts.platform);
  }

  const { rows } = await pool.query(
    `SELECT ${CHANNEL_COLS} FROM agent_channels WHERE ${conditions.join(" AND ")} ORDER BY created_at`,
    params,
  );
  return rows as AgentChannel[];
}

export async function getChannelsByPlatform(platform: ChannelPlatform): Promise<AgentChannel[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${CHANNEL_COLS} FROM agent_channels WHERE platform = $1 AND enabled = true ORDER BY created_at`,
    [platform],
  );
  return rows as AgentChannel[];
}

export async function updateChannel(
  id: string,
  updates: Partial<Pick<AgentChannel, "config" | "enabled" | "receive_announcements">>,
): Promise<AgentChannel> {
  const pool = getPool();
  const entries = Object.entries(updates).filter(([k]) =>
    ["config", "enabled", "receive_announcements"].includes(k),
  );
  if (entries.length === 0) {
    const { rows } = await pool.query(
      `SELECT ${CHANNEL_COLS} FROM agent_channels WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new Error(`Channel not found: ${id}`);
    return rows[0] as AgentChannel;
  }

  const sets = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(", ");
  const vals = entries.map(([k, v]) => (k === "config" ? JSON.stringify(v) : v));

  const { rows } = await pool.query(
    `UPDATE agent_channels SET ${sets} WHERE id = $1 RETURNING ${CHANNEL_COLS}`,
    [id, ...vals],
  );
  if (rows.length === 0) throw new Error(`Channel not found: ${id}`);
  return rows[0] as AgentChannel;
}

export async function deleteChannel(id: string): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM agent_channels WHERE id = $1`, [id]);
  if (rowCount === 0) throw new Error(`Channel not found: ${id}`);
}
