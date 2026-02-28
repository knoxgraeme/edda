/**
 * ChannelAdapter — shared interface for all platform chat integrations.
 *
 * Each platform (Telegram, Discord, Slack) implements this interface to handle
 * inbound messages, outbound delivery, auth, and lifecycle management.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelPlatform } from "@edda/db";

/** Result of parsing a platform-specific inbound message. */
export interface ParsedMessage {
  text: string;
  externalId: string; // "{chat_id}:{thread_id}" format
  platformUserId: string; // platform-native user identifier
  replyContext?: unknown; // platform-specific context for sending replies
}

/** Handle for a sent message, used for progressive edits. */
export interface MessageHandle {
  messageId: string;
  externalId: string;
}

export interface ChannelAdapter {
  readonly platform: ChannelPlatform;
  /** Max characters per message. Used by streamToAdapter for splitting. */
  readonly maxMessageLength: number;

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

  // --- Auth ---
  /** Check if a user is authorized to interact. Platform-specific logic. */
  isAuthorized(platformUserId: string, context?: unknown): Promise<boolean>;

  // --- Outbound ---
  /** Send a complete text message (for announcements, final replies). */
  send(externalId: string, text: string): Promise<void>;

  // --- Streaming (optional — adapters that support progressive updates) ---
  /** Send an initial message and return a handle for subsequent edits. */
  sendInitial?(externalId: string, text: string, replyContext?: unknown): Promise<MessageHandle>;
  /** Edit an existing message with updated content. */
  editMessage?(handle: MessageHandle, text: string): Promise<void>;

  // --- UX ---
  /** Send a typing indicator. Called periodically during agent execution. */
  sendTypingIndicator?(externalId: string, replyContext?: unknown): Promise<void>;
}
