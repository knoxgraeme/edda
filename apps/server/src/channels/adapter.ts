/**
 * ChannelAdapter — shared interface for all platform chat integrations.
 *
 * Each platform (Telegram, Discord, Slack) implements this interface to handle
 * inbound messages, outbound delivery, and lifecycle management.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelPlatform, PendingAction } from "@edda/db";

/** Result of parsing a platform-specific inbound message. */
export interface ParsedMessage {
  text: string;
  externalId: string; // "{chat_id}:{thread_id}" format
  platformUserId: string; // platform-native user identifier
}

/** Handle returned by sendInitial(), used to edit a sent message in-place. */
export interface MessageHandle {
  messageId: string;
  externalId: string;
}

export interface ChannelAdapter {
  readonly platform: ChannelPlatform;

  /** Platform's maximum message length (used for split decisions during streaming). */
  readonly maxMessageLength?: number;

  // --- Lifecycle ---
  init(): Promise<void>;
  shutdown(): Promise<void>;

  // --- Inbound ---
  /**
   * Handle a raw HTTP request from the platform webhook/events endpoint.
   * Covers Telegram webhooks, Discord Interactions, and Slack Events API.
   * For platforms with persistent connections (Discord Gateway, Slack Socket Mode),
   * the adapter's init() sets up its own event listeners that call
   * handleInboundMessage() directly — handleWebhook is for HTTP-based events only.
   */
  handleWebhook?(req: IncomingMessage, res: ServerResponse): Promise<void>;

  // --- Outbound ---
  /** Send a complete text message (for announcements, final replies). */
  send(externalId: string, text: string): Promise<void>;

  // --- Streaming outbound ---
  /** Send the first chunk of a streamed response. Returns a handle for subsequent edits. */
  sendInitial?(externalId: string, text: string): Promise<MessageHandle>;

  /** Edit a previously sent message in-place (for progressive streaming updates). */
  editMessage?(handle: MessageHandle, text: string): Promise<void>;

  // --- UX ---
  /** Send a typing indicator. Called periodically during agent execution. */
  sendTypingIndicator?(externalId: string): Promise<void>;

  // --- Confirmations ---
  /** Send an action confirmation prompt with approve/reject buttons. */
  sendActionPrompt?(externalId: string, action: PendingAction): Promise<MessageHandle | void>;
}
