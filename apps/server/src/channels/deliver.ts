/**
 * Platform-agnostic channel delivery dispatcher.
 *
 * Given an AgentChannel row, routes the message to the correct
 * platform adapter's send function.
 */

import type { AgentChannel } from "@edda/db";
import type { ChannelAdapter } from "./adapter.js";

const adapters = new Map<string, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.platform, adapter);
}

export function getAdapter(platform: string): ChannelAdapter | undefined {
  return adapters.get(platform);
}

export async function deliverToChannel(channel: AgentChannel, text: string): Promise<void> {
  const adapter = adapters.get(channel.platform);
  if (!adapter) {
    throw new Error(
      `No adapter registered for platform "${channel.platform}". ` +
        `Ensure the ${channel.platform} adapter is initialized before attempting delivery.`,
    );
  }
  await adapter.send(channel.external_id, text);
}
