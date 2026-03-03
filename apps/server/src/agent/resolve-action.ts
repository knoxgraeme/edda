/**
 * Resolve a pending action (approve/reject) and handle side effects:
 * - Atomic DB update (race-safe)
 * - Update channel surfaces (remove buttons, show resolution status)
 * - If approved, execute the original tool
 */

import { resolvePendingAction } from "@edda/db";
import type { PendingAction } from "@edda/db";
import { getAdapter } from "../channels/deliver.js";
import { executeApprovedAction } from "./execute-approved-action.js";
import { getLogger } from "../logger.js";

export interface ResolveResult {
  action: PendingAction;
  toolResult?: string;
}

/**
 * Resolve a pending action and handle all side effects.
 * Returns null if the action was already resolved (atomic race protection).
 */
export async function resolveAndNotify(
  actionId: string,
  decision: "approved" | "rejected",
  resolvedBy: string,
): Promise<ResolveResult | null> {
  const log = getLogger();

  // Atomic resolve — returns null if already resolved
  const action = await resolvePendingAction(actionId, decision, resolvedBy);
  if (!action) return null;

  // Update channel surfaces — best-effort, don't block on failures
  await updateChannelSurfaces(action, decision, resolvedBy);

  // If approved, execute the original tool
  let toolResult: string | undefined;
  if (decision === "approved") {
    try {
      toolResult = await executeApprovedAction(action);
      log.info({ actionId, tool: action.tool_name }, "Approved action executed");
    } catch (err) {
      log.error({ actionId, err }, "Failed to execute approved action");
      throw err;
    }
  } else {
    log.info({ actionId, tool: action.tool_name }, "Action rejected");
  }

  return { action, toolResult };
}

/**
 * Update all channel surfaces that have confirmation messages.
 * Edits messages to remove buttons and show resolution status.
 */
async function updateChannelSurfaces(
  action: PendingAction,
  decision: "approved" | "rejected",
  resolvedBy: string,
): Promise<void> {
  const log = getLogger();
  const statusText =
    decision === "approved"
      ? `Approved by ${resolvedBy}`
      : `Rejected by ${resolvedBy}`;

  for (const ref of action.channel_refs) {
    try {
      const adapter = getAdapter(ref.platform);
      if (adapter?.editMessage) {
        await adapter.editMessage(
          { messageId: ref.message_id, externalId: ref.external_id },
          `${action.description}\n\n${statusText}`,
        );
      }
    } catch (err) {
      log.warn(
        { platform: ref.platform, messageId: ref.message_id, err },
        "Failed to update channel surface for resolved action",
      );
    }
  }
}
