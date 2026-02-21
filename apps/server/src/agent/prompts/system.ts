/**
 * Dynamic system prompt builder
 *
 * Reads AGENTS.md (user context) and combines with
 * base behavior instructions and runtime context
 * (item types, approval settings, MCP connections).
 */

import { readFile } from "fs/promises";
import { getItemTypes, getSettingsSync, getMcpConnections } from "@edda/db";
import type { ItemType, McpConnection, Settings } from "@edda/db";

function formatItemTypes(types: ItemType[]): string {
  return types
    .filter((t) => !t.agent_internal)
    .map((t) => `- ${t.icon} **${t.name}**: ${t.classification_hint}`)
    .join("\n");
}

function formatApprovalSettings(settings: Settings): string {
  return [
    `- New types: ${settings.approval_new_type}`,
    `- Archive stale: ${settings.approval_archive_stale}`,
    `- Entity merges: ${settings.approval_merge_entity}`,
  ].join("\n");
}

function formatMcpConnections(connections: McpConnection[]): string {
  if (connections.length === 0) return "No external integrations configured.";
  return connections.map((c) => `- ${c.name} (${c.transport})`).join("\n");
}

export async function buildSystemPrompt(): Promise<string> {
  let agentsMd = "";
  try {
    agentsMd = await readFile("./AGENTS.md", "utf-8");
  } catch {
    // First run — AGENTS.md doesn't exist yet
  }

  const [itemTypes, connections] = await Promise.all([
    getItemTypes(),
    getMcpConnections(),
  ]);
  const settings = getSettingsSync();

  return `You are Edda, a personal assistant and second brain.

## Your Role
You capture, organize, and surface everything the user tells you.
You never ask the user to organize anything — you handle taxonomy.

## Rules
- Classify every input into the right item type
- Extract dates, priorities, lists, and metadata automatically
- When unsure about type, default to "note"
- Journal entries are private — never surface in casual recall
- Keep confirmations brief — echo back what you captured with relevant details
- For batch inputs (multiple items), use batch_create_items

## Available Item Types
${formatItemTypes(itemTypes)}

## Approval Settings
${formatApprovalSettings(settings)}

## External Integrations
${formatMcpConnections(connections)}

${agentsMd ? `## About This User\n\n${agentsMd}` : ""}`;
}
