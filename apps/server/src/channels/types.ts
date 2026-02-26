/**
 * Shared types for channel adapters.
 */

import type { ChannelPlatform } from "@edda/db";

export interface ChannelSender {
  platform: ChannelPlatform;
  send(externalId: string, text: string): Promise<void>;
}
