/**
 * Dynamic system prompt builder
 *
 * Reads AGENTS.md (user context) and combines with
 * base behavior instructions and runtime context
 * (item types, approval settings, MCP connections).
 */

import { readFile } from "fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getItemTypes, getSettingsSync, getMcpConnections, getSkillSummaries } from "@edda/db";
import type { ItemType, McpConnection, Settings, Skill } from "@edda/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_MD_PATH = join(__dirname, "../../AGENTS.md");

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

function formatSkills(skills: Pick<Skill, "name" | "description">[]): string {
  if (skills.length === 0) return "No skills loaded.";
  return skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
}

export async function buildSystemPrompt(): Promise<string> {
  const [agentsMd, itemTypes, connections, skills] = await Promise.all([
    readFile(AGENTS_MD_PATH, "utf-8").catch(() => ""),
    getItemTypes(),
    getMcpConnections(),
    getSkillSummaries(),
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

## Recall
- When the user asks about a person, project, or company, use get_entity_items first
- When answering questions that might involve stored knowledge, use search_items
- At the start of each session, consider get_dashboard to see what's actionable today
- For date-specific questions ("what happened last week"), use get_timeline
- Use get_agent_knowledge to review learned preferences and facts when relevant
- Prefer entity lookups over semantic search when you know the specific entity name
- When the user asks about pending items or approvals, use get_pending_items

## Thread Processing
- Use get_unprocessed_threads to find conversations not yet processed by memory extraction
- Use get_thread_messages to read the full message history of a thread
- Use mark_thread_processed after extracting knowledge from a thread
- Use list_threads to browse recent conversation history

## Working Memory
You have an ephemeral scratch pad for within-conversation reasoning. Use write_file, read_file, and edit_file to store intermediate work, draft responses, or track state during complex multi-step tasks. Files are per-conversation and do not persist across sessions.

## Available Item Types
${formatItemTypes(itemTypes)}

## Approval Settings
${formatApprovalSettings(settings)}

## External Integrations
${formatMcpConnections(connections)}

## Skills
${formatSkills(skills)}

${agentsMd ? `## About This User\n\n${agentsMd}` : ""}`;
}
