/**
 * Unified agent builder — creates any agent from an Agent DB row.
 *
 * One builder for all agents. The server entrypoint, cron runner, and
 * on-demand execution all call buildAgent(). Differences come from
 * DB configuration (tools, skills, subagents, store access, filesystem),
 * not from code.
 *
 * Each agent gets:
 * - Scoped tools from the full pool (built-in + MCP + search)
 * - /skills/ StoreBackend mount (deepagents progressive disclosure)
 * - /store/ StoreBackend mount (own namespace, persistent cross-thread)
 * - Optional /store/{name}/ cross-agent mounts (from metadata.stores)
 * - Optional /workspace/ FilesystemBackend (env-gated, from metadata.filesystem)
 * - AGENTS.md context, store instructions, settings context
 * - get_my_history tool (always included)
 */

import { randomUUID } from "node:crypto";
import { createDeepAgent } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import type { BaseStore } from "@langchain/langgraph";
import type { Agent, Settings } from "@edda/db";
import {
  getSettings,
  getAgentsMdContent,
  getAgentByName,
  getItemTypes,
  getMcpConnections,
  getSkillByName,
} from "@edda/db";
import type { ItemType, McpConnection } from "@edda/db";
import { getChatModel } from "../llm/index.js";
import { getCheckpointer } from "../checkpointer/index.js";
import { getStore } from "../store/index.js";
import { getSearchTool } from "../search/index.js";
import { loadMCPTools } from "./mcp.js";
import { collectSkillTools } from "./skill-loader.js";
import { allTools } from "./tools/index.js";
import { buildBackend } from "./backends.js";

// ---------------------------------------------------------------------------
// Tool scoping
// ---------------------------------------------------------------------------

/**
 * Scope tools for an agent from the full available pool.
 *
 * Resolution (additive):
 * 1. Collect allowed-tools from all of the agent's skills (union)
 * 2. Add any individual tool names from agent.tools[]
 * 3. Filter available tools to only those in the resolved set
 * 4. Always include get_my_history
 *
 * Empty declared set = all tools (backward compatible).
 */
function scopeTools(agent: Agent, available: StructuredTool[]): StructuredTool[] {
  const declared = collectSkillTools(agent.skills);
  for (const t of agent.tools) declared.add(t);

  if (declared.size === 0) return available; // empty = all

  declared.add("get_my_history"); // always included

  const byName = new Map(available.map((t) => [t.name, t]));
  const tools: StructuredTool[] = [];
  for (const name of declared) {
    const tool = byName.get(name);
    if (tool) tools.push(tool);
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Duplicate tool check
// ---------------------------------------------------------------------------

function assertNoDuplicateTools(tools: StructuredTool[]): void {
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) {
      throw new Error(
        `Duplicate tool name detected: "${t.name}". MCP tools must not shadow built-in tools.`,
      );
    }
    seen.add(t.name);
  }
}

// ---------------------------------------------------------------------------
// Skills → Store bridge
// ---------------------------------------------------------------------------

/**
 * Write an agent's declared skills from the DB into the PostgresStore.
 * deepagents' SkillsMiddleware discovers them via progressive disclosure.
 */
async function writeSkillsToStore(agent: Agent, store: BaseStore): Promise<void> {
  for (const skillName of agent.skills) {
    try {
      const skill = await getSkillByName(skillName);
      if (!skill?.content) continue;

      const now = new Date().toISOString();
      await store.put(["filesystem"], `/skills/${skillName}/SKILL.md`, {
        content: skill.content.split("\n"),
        created_at: now,
        modified_at: now,
      });
    } catch (err) {
      console.error(
        `[buildAgent] Failed to load skill "${skillName}" for agent "${agent.name}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Subagent resolution
// ---------------------------------------------------------------------------

/**
 * Resolve subagent specs from the DB. Each subagent gets its own scoped
 * tools and skills written to the store.
 */
async function resolveSubagents(
  names: string[],
  available: StructuredTool[],
  store: BaseStore,
) {
  const specs = [];
  for (const name of names) {
    const row = await getAgentByName(name);
    if (!row || !row.enabled) continue;

    const tools = scopeTools(row, available);

    // Write subagent's scoped skills into the store
    await writeSkillsToStore(row, store);

    const prompt = row.system_prompt || `You are ${row.name}.`;

    specs.push({
      name: row.name,
      description: row.description,
      systemPrompt: prompt,
      tools,
      skills: row.skills.length > 0 ? ["/skills/"] : [],
    });
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Prompt builder — unified for all agents
// ---------------------------------------------------------------------------

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

/**
 * Build the system prompt for any agent.
 *
 * All agents get: AGENTS.md context, store instructions, settings context.
 * The default agent (edda) gets additional orchestrator-specific sections.
 * Skill content is NOT injected — deepagents handles skill discovery via
 * the /skills/ store mount and progressive disclosure.
 */
async function buildPrompt(agent: Agent, settings: Settings): Promise<string> {
  const [agentContext, itemTypes, connections] = await Promise.all([
    getAgentsMdContent(agent.name),
    getItemTypes(),
    getMcpConnections(),
  ]);

  const now = new Date();
  const currentDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const currentTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  const today = now.toISOString().split("T")[0];

  // Base prompt: agent's system_prompt field, or a sensible default
  const base =
    agent.system_prompt || `You are ${agent.name}, an Edda background agent.`;

  const contextSection = agentContext ? `\n\n## About This User\n\n${agentContext}` : "";

  // Store instructions — all agents have /store/
  const storeSection = `\n\n## Persistent Store
Write durable output to /store/ using write_file. For example:
- write_file /store/${today} — today's output
- write_file /store/latest — most recent summary
You can also read your past output via read_file /store/.`;

  const settingsContext = `\n\n## Context
- Today: ${currentDate}, ${currentTime}
- Timezone: ${settings.user_timezone}
${settings.user_display_name ? `- User: ${settings.user_display_name}` : ""}`;

  // Orchestrator-specific sections (item types, approvals, integrations, etc.)
  // These are included for the default agent and any agent with all tools (empty tools[]).
  const isOrchestrator = agent.tools.length === 0;
  let orchestratorSections = "";
  if (isOrchestrator) {
    orchestratorSections = `

## Available Item Types
${formatItemTypes(itemTypes)}

## Approval Settings
${formatApprovalSettings(settings)}

## External Integrations
${formatMcpConnections(connections)}`;
  }

  return `${base}${contextSection}${storeSection}${settingsContext}${orchestratorSections}`;
}

// ---------------------------------------------------------------------------
// Thread ID resolver
// ---------------------------------------------------------------------------

export function resolveThreadId(agent: Agent): string {
  const today = new Date().toISOString().split("T")[0];
  switch (agent.context_mode) {
    case "isolated":
      return `task-${agent.name}-${randomUUID()}`;
    case "daily":
      return `task-${agent.name}-${today}`;
    case "persistent":
      return `task-${agent.name}`;
    default:
      throw new Error(
        `Unknown context_mode "${agent.context_mode}" for agent "${agent.name}". ` +
          `Expected "isolated", "daily", or "persistent".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Model settings key allowlist
// ---------------------------------------------------------------------------

export const MODEL_SETTINGS_KEYS = new Set([
  "default_model",
  "daily_digest_model",
  "memory_catchup_model",
  "weekly_review_model",
  "type_evolution_model",
  "context_refresh_model",
]);

// ---------------------------------------------------------------------------
// buildAgent — unified entry point
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildAgent(agent: Agent): Promise<any> {
  const settings = await getSettings();

  // 1. Model — per-agent override via model_settings_key
  const modelName =
    agent.model_settings_key && MODEL_SETTINGS_KEYS.has(agent.model_settings_key)
      ? ((settings as unknown as Record<string, unknown>)[agent.model_settings_key] as
          | string
          | undefined)
      : undefined;

  // 2. Gather ALL available tools (built-in + MCP + search)
  const [model, searchTool, checkpointer, store, mcpTools] = await Promise.all([
    getChatModel(modelName),
    getSearchTool(),
    getCheckpointer(),
    getStore(),
    loadMCPTools(),
  ]);

  const allAvailable = [
    ...allTools,
    ...mcpTools,
    ...(searchTool ? [searchTool] : []),
  ];

  // 3. Scope tools (empty agent.tools[] = all tools, otherwise filter by name)
  const tools = scopeTools(agent, allAvailable);

  // 4. Duplicate check
  assertNoDuplicateTools(tools);

  // 5. Subagents (any agent can have them)
  const subagents =
    agent.subagents.length > 0
      ? await resolveSubagents(agent.subagents, allAvailable, store)
      : [];

  // 6. Write this agent's scoped SKILL.md files into the store
  await writeSkillsToStore(agent, store);

  // 7. System prompt — unified builder (no skill content injection)
  const systemPrompt = await buildPrompt(agent, settings);

  // 8. Backend — closes over store for SkillsMiddleware compatibility
  const backend = await buildBackend(agent, store);

  return createDeepAgent({
    name: agent.name,
    model,
    tools,
    systemPrompt,
    checkpointer,
    store,
    backend,
    subagents,
    skills: ["/skills/"],
  });
}
