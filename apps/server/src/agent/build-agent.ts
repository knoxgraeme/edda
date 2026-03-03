/**
 * Unified agent builder — creates any agent from an Agent DB row.
 *
 * One builder for all agents. The server entrypoint, cron runner, and
 * on-demand execution all call buildAgent(). Differences come from
 * DB configuration (tools, skills, subagents, store access), not from code.
 *
 * Each agent gets:
 * - Scoped tools from the full pool (built-in + MCP + search)
 * - /skills/ StoreBackend mount (deepagents progressive disclosure)
 * - /store/ StoreBackend mount (own namespace, persistent cross-thread)
 * - Optional /store/{name}/ cross-agent mounts (from metadata.stores)
 * - Three-layer prompt: agent prompt + AGENTS.md memory + system context
 * - list_my_runs tool (always included)
 */

import { randomUUID } from "node:crypto";
import { createDeepAgent } from "deepagents";
import type { SandboxBackendProtocol } from "deepagents";
import type { LanguageModelLike } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import type { BaseStore } from "@langchain/langgraph";
import type { Agent, Settings } from "@edda/db";
import {
  getSettings,
  getAgentsMdContent,
  getAgentsByNames,
  getSkillsByNames,
} from "@edda/db";
import type { Skill } from "@edda/db";
import { getModelString, resolveModel } from "../llm.js";
import { getCheckpointer } from "../checkpointer.js";
import { getStore } from "../store.js";
import { getSearchTool } from "../search.js";
import { loadMCPTools } from "../mcp/client.js";
import { allTools, loadCommunityTools, toolInterruptDefaults } from "./tools/index.js";
import type { InterruptLevel } from "./tools/index.js";
import { wrapInterruptibleTools } from "./interrupt-wrapper.js";
import { buildBackend } from "./backends.js";
import { SecureSandbox, createSandbox } from "./sandbox.js";
import { getLogger } from "../logger.js";
import { isGeminiModel, normalizeToolForGemini } from "./normalize-schemas.js";
import { formatDateInTimezoneOrUtc, isValidIanaTimezone } from "../utils/timezone.js";
import { createLazyToolsMiddleware } from "./middleware/lazy-tools.js";
import type { SkillToolMapping } from "./middleware/lazy-tools.js";

// ---------------------------------------------------------------------------
// Skill frontmatter parsing (DB-backed, no disk reads)
// ---------------------------------------------------------------------------

/** Parse a YAML list from SKILL.md frontmatter by key name. */
function parseFrontmatterList(raw: string, key: string): string[] {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  const lines = fmMatch[1].split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (idx === -1) return [];

  const items: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+)$/);
    if (m) items.push(m[1].trim());
    else if (lines[i].trim()) break;
  }
  return items;
}

/**
 * Collect the union of a frontmatter list key across all skills.
 * Returns an empty set if no skills declare the key.
 */
function collectFromSkills(skills: Skill[], key: string): Set<string> {
  const result = new Set<string>();
  let anyDeclared = false;
  for (const skill of skills) {
    if (!skill.content) continue;
    const items = parseFrontmatterList(skill.content, key);
    if (items.length > 0) {
      anyDeclared = true;
      for (const item of items) result.add(item);
    }
  }
  return anyDeclared ? result : new Set();
}

// ---------------------------------------------------------------------------
// Tool scoping
// ---------------------------------------------------------------------------

/**
 * Scope tools for an agent from the full available pool.
 *
 * Resolution (additive):
 * 1. Collect allowed-tools from all of the agent's skills (union)
 * 2. Add any individual tool names from agent.tools[]
 * 3. Always include list_my_runs
 * 4. Filter available tools to only those in the resolved set
 *
 * Every agent must explicitly declare its tools via skills or agent.tools[].
 * An agent with no skills and no tools receives only list_my_runs.
 */
function scopeTools(available: StructuredTool[], declared: Set<string>): StructuredTool[] {
  const byName = new Map(available.map((t) => [t.name, t]));
  const tools: StructuredTool[] = [];
  for (const name of declared) {
    const tool = byName.get(name);
    if (tool) tools.push(tool);
  }
  return tools;
}

/**
 * Ensure every plain JSON schema tool has type: "object".
 * Anthropic requires input_schema.type === "object" on every tool.
 * MCP tools (plain JSON schemas after simplifyJsonSchemaForLLM) may have
 * type missing entirely, or set to a non-object value (e.g. "string").
 * Zod-based tools are handled correctly by @langchain/anthropic's
 * formatStructuredToolToAnthropic, so we skip them here.
 */
function ensureObjectSchemas(tools: StructuredTool[]): void {
  for (const t of tools) {
    const schema = t.schema as Record<string, unknown> | undefined;
    if (schema && typeof schema === "object" && !("_def" in schema) && !("_zod" in schema)) {
      if (schema.type !== "object") {
        getLogger().debug(
          { tool: t.name, originalType: schema.type ?? "(missing)" },
          "Patched non-object schema type on tool",
        );
        schema.type = "object";
        if (!schema.properties) {
          schema.properties = {};
        }
      }
    }
  }
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

import { writeSkillsToStore } from "./skill-utils.js";

// ---------------------------------------------------------------------------
// Subagent resolution
// ---------------------------------------------------------------------------

interface SubagentSpec {
  name: string;
  description: string;
  systemPrompt: string;
  tools: StructuredTool[];
  skills: string[];
  model?: LanguageModelLike | string;
}

/**
 * Resolve subagent specs from the DB. Each subagent gets its own scoped
 * tools, skills, system prompt (with AGENTS.md context), and model.
 */
async function resolveSubagents(
  names: string[],
  available: StructuredTool[],
  store: BaseStore,
  settings: Settings,
): Promise<SubagentSpec[]> {
  if (names.length === 0) return [];

  const rows = await getAgentsByNames(names);
  const enabled = rows.filter((r) => r.enabled);

  // Fetch all subagent skills from DB in one batch
  const allSkillNames = [...new Set(enabled.flatMap((r) => r.skills))];
  const allSkills = allSkillNames.length > 0 ? await getSkillsByNames(allSkillNames) : [];
  const skillsByName = new Map(allSkills.map((s) => [s.name, s]));

  const getRowSkills = (row: Agent): Skill[] =>
    row.skills.map((n) => skillsByName.get(n)).filter(Boolean) as Skill[];

  // Write all subagent skills + build prompts + resolve models in parallel
  const [, ...specs] = await Promise.all([
    Promise.all(enabled.map((row) => writeSkillsToStore(getRowSkills(row), store))),
    ...enabled.map(async (row) => {
      const modelString = getModelString(row.model_provider, row.model);
      const model = resolveModel(row.model_provider, row.model);
      const systemPrompt = await buildPrompt(row, settings);

      const declared = collectFromSkills(getRowSkills(row), "allowed-tools");
      for (const t of row.tools) declared.add(t);
      declared.add("list_my_runs");
      const scoped = scopeTools(available, declared);
      ensureObjectSchemas(scoped);
      const subTools = isGeminiModel(modelString) ? scoped.map(normalizeToolForGemini) : scoped;

      return {
        name: row.name,
        description: row.description,
        systemPrompt,
        tools: subTools,
        skills: row.skills.length > 0 ? ["/skills/"] : [],
        model,
      } satisfies SubagentSpec;
    }),
  ]);

  return specs;
}

// ---------------------------------------------------------------------------
// Prompt builder — unified for all agents
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for any agent.
 *
 * Three layers:
 * 1. Agent prompt — agent.system_prompt (task description, agent-editable)
 * 2. Memory — AGENTS.md content (agent-editable via save_agents_md)
 * 3. System context — capabilities, rules, context (deterministic, firm)
 *
 * Dynamic data (item types, lists, approval settings) is available via tools
 * and skills — not baked into the system prompt. Memory guidelines live in
 * the self_improvement and capture skills.
 */
export async function buildPrompt(
  agent: Agent,
  settings: Settings,
): Promise<string> {
  const agentContext = await getAgentsMdContent(agent.name);

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

  // ── Layer 1: Agent prompt (agent-editable task description) ──
  const agentPrompt = agent.system_prompt?.trim() || (() => {
    getLogger().warn({ agent: agent.name }, "Agent has no system_prompt — using generic fallback");
    return `You are ${agent.name}, an Edda agent.`;
  })();

  // ── Layer 2: Memory (AGENTS.md content) ──
  const memorySection = agentContext
    ? `\n\n## Memory\n\n<agent_memory>\n${agentContext}\n</agent_memory>`
    : "";

  // ── Layer 3: System context (deterministic, firm) ──

  // Delegation guidance — only when agent has both run_agent and subagents
  const hasRunAgent =
    agent.tools.includes("run_agent") || agent.tools.length === 0;
  const hasSubagents = agent.subagents.length > 0;
  const delegationLine =
    hasRunAgent && hasSubagents
      ? `\n- Delegation: \`task\` (synchronous subagent, returns result inline) vs \`run_agent\` (async, returns task_run_id)`
      : "";

  const capabilities = `\n\n## Capabilities
- Store: write durable output to /store/ using write_file (e.g. /store/${today}, /store/latest). Read past output via read_file /store/.
- Skills: task-specific instructions loaded on demand from /skills/${delegationLine}`;

  const rules = `\n\n## Rules
- Always search before creating duplicate items
- AGENTS.md token budget: ${settings.agents_md_token_budget}
- Use recall/search_items for specific facts — AGENTS.md is for operating patterns, not data`;

  const context = `\n\n## Context
- Today: ${currentDate}, ${currentTime}
- Timezone: ${settings.user_timezone}
${settings.user_display_name ? `- User: ${settings.user_display_name}\n` : ""}- Memory capture: ${agent.memory_capture ? "enabled" : "disabled"}`;

  return `${agentPrompt}${memorySection}${capabilities}${rules}${context}`;
}

// ---------------------------------------------------------------------------
// Thread ID resolver
// ---------------------------------------------------------------------------

export function resolveThreadId(
  agent: Agent,
  channel?: { platform: string; external_id: string },
  options?: { timezone?: string; now?: Date },
): string {
  const channelSuffix =
    agent.thread_scope === "per_channel" && channel
      ? `-${channel.platform}:${channel.external_id}`
      : "";

  const now = options?.now ?? new Date();
  const timezone = options?.timezone;
  if (timezone && !isValidIanaTimezone(timezone)) {
    getLogger().warn({ timezone, agent: agent.name }, "Invalid user_timezone; falling back to UTC date");
  }
  const today = formatDateInTimezoneOrUtc(now, timezone);
  switch (agent.thread_lifetime) {
    case "ephemeral":
      return `task-${agent.name}-${randomUUID()}`;
    case "daily":
      return `task-${agent.name}-${today}${channelSuffix}`;
    case "persistent":
      return `task-${agent.name}${channelSuffix}`;
    default:
      throw new Error(
        `Unknown thread_lifetime "${agent.thread_lifetime}" for agent "${agent.name}". ` +
          `Expected "ephemeral", "daily", or "persistent".`,
      );
  }
}

// ---------------------------------------------------------------------------
// buildAgent — unified entry point
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DeepAgent's generic type is too complex for tsc
export async function buildAgent(agent: Agent): Promise<any> {
  const settings = await getSettings();

  // 1. Model — provider:model string (or ChatOpenRouter instance for openrouter)
  const modelString = getModelString(agent.model_provider, agent.model);
  const model = resolveModel(agent.model_provider, agent.model);

  // 2. Gather ALL available tools + prompt data + skills in one parallel batch
  const [
    searchTool,
    checkpointer,
    store,
    mcpTools,
    communityTools,
    skills,
  ] = await Promise.all([
    getSearchTool(),
    getCheckpointer(),
    getStore(),
    loadMCPTools(),
    loadCommunityTools(),
    agent.skills.length > 0 ? getSkillsByNames(agent.skills) : ([] as Skill[]),
  ]);

  const allAvailable = [
    ...allTools,
    ...mcpTools,
    ...communityTools,
    ...(searchTool ? [searchTool] : []),
  ];

  // 3. Compute declared tool names once (skills + agent.tools + list_my_runs)
  const declaredToolNames = collectFromSkills(skills, "allowed-tools");
  for (const t of agent.tools) declaredToolNames.add(t);
  declaredToolNames.add("list_my_runs");

  let tools = scopeTools(allAvailable, declaredToolNames);

  // 3b. Normalize plain JSON schemas for Anthropic compatibility
  ensureObjectSchemas(tools);

  // 3c. Gemini schema normalization — convert Zod schemas to pre-normalized
  // JSON Schema to avoid unsupported features (const, anyOf, array type).
  if (isGeminiModel(modelString)) {
    tools = tools.map(normalizeToolForGemini);
    getLogger().debug({ agent: agent.name }, "Normalized tool schemas for Gemini compatibility");
  }

  // 3d. Wrap interruptible tools
  const interruptOverrides = (agent.metadata?.interrupt_overrides ?? {}) as Record<
    string,
    InterruptLevel
  >;
  const interruptTtl = (agent.metadata?.interrupt_ttl as string) ?? "1 hour";
  tools = wrapInterruptibleTools(tools, {
    defaults: toolInterruptDefaults,
    overrides: interruptOverrides,
    agentName: agent.name,
    ttl: interruptTtl,
  });

  if (getLogger().isLevelEnabled("debug")) {
    getLogger().debug(
      { agent: agent.name, toolCount: tools.length, toolNames: tools.map((t) => t.name) },
      "Scoped tools for agent",
    );
  }

  // 4. Duplicate check
  assertNoDuplicateTools(tools);

  // 4b. Sandbox — if agent's scoped tools include execute, create sandbox
  const wantsExecute = declaredToolNames.has("execute");

  let sandbox: SandboxBackendProtocol | undefined;
  if (wantsExecute) {
    const rawSandbox = await createSandbox(settings);
    if (rawSandbox) {
      const skillCommands = collectFromSkills(skills, "allowed-commands");
      sandbox = new SecureSandbox(rawSandbox, skillCommands.size > 0 ? skillCommands : undefined);
    }
  }

  // 5. Subagents (any agent can have them)
  const subagents =
    agent.subagents.length > 0
      ? await resolveSubagents(agent.subagents, allAvailable, store, settings)
      : [];

  // 6. Write this agent's scoped SKILL.md files into the store
  await writeSkillsToStore(skills, store);

  // 7. System prompt — three-layer builder (agent prompt + memory + system context)
  const systemPrompt = await buildPrompt(agent, settings);

  // 8. Backend — closes over store for SkillsMiddleware compatibility
  const backend = await buildBackend(agent, store, { sandbox });

  // 9. Lazy tools middleware — only include skill tools after the agent reads the SKILL.md.
  //    Only enabled when agent.tools[] has explicit core tools (opt-in per agent).
  const middleware = [];
  if (agent.tools.length > 0 && skills.length > 0) {
    const skillToTools = new Map<string, Set<string>>();
    for (const skill of skills) {
      if (!skill.content) continue;
      const toolNames = parseFrontmatterList(skill.content, "allowed-tools");
      if (toolNames.length > 0) {
        skillToTools.set(skill.name, new Set(toolNames));
      }
    }

    if (skillToTools.size > 0) {
      const coreTools = new Set(agent.tools);
      coreTools.add("list_my_runs");
      const mapping: SkillToolMapping = { skillToTools, coreTools };
      middleware.push(createLazyToolsMiddleware(mapping));
      getLogger().debug(
        {
          agent: agent.name,
          coreTools: [...coreTools],
          lazySkills: [...skillToTools.keys()],
        },
        "Lazy tools middleware enabled",
      );
    }
  }

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
    ...(middleware.length > 0 ? { middleware } : {}),
  });
}
