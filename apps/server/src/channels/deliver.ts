/**
 * Platform-agnostic channel delivery dispatcher.
 *
 * Given an AgentChannel row, routes the message to the correct
 * platform adapter's send function.
 */

import type { AgentChannel } from "@edda/db";
import type { ChannelSender } from "./types.js";

const senders = new Map<string, ChannelSender>();

export function registerSender(sender: ChannelSender): void {
  senders.set(sender.platform, sender);
}

export async function deliverToChannel(channel: AgentChannel, text: string): Promise<void> {
  const sender = senders.get(channel.platform);
  if (!sender) {
    console.warn(`[deliver] No sender registered for platform "${channel.platform}", skipping`);
    return;
  }
  await sender.send(channel.external_id, text);
}
