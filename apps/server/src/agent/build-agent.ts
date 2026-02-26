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
 * - Three-layer prompt: agent prompt + AGENTS.md memory + system context
 * - list_my_runs tool (always included)
 */

import { randomUUID } from "node:crypto";
import { createDeepAgent } from "deepagents";
import type { LanguageModelLike } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import type { BaseStore } from "@langchain/langgraph";
import type { Agent, Settings } from "@edda/db";
import {
  getSettings,
  getAgentsMdContent,
  getAgentsByNames,
  getItemTypes,
  getSkillsByNames,
  getAllLists,
} from "@edda/db";
import type { ListWithCount } from "@edda/db";
import type { ItemType, Skill } from "@edda/db";
import { getChatModel } from "../llm/index.js";
import { getCheckpointer } from "../checkpointer/index.js";
import { getStore } from "../store/index.js";
import { getSearchTool } from "../search/index.js";
import { loadMCPTools } from "./mcp.js";
import { allTools, loadCommunityTools } from "./tools/index.js";
import { buildBackend } from "./backends.js";

// ---------------------------------------------------------------------------
// Skill frontmatter parsing (DB-backed, no disk reads)
// ---------------------------------------------------------------------------

/** Parse allowed-tools list from YAML frontmatter in SKILL.md content. */
function parseAllowedTools(raw: string): string[] {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  const lines = fmMatch[1].split("\n");
  const idx = lines.findIndex((l) => l.startsWith("allowed-tools:"));
  if (idx === -1) return [];

  const tools: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+)$/);
    if (m) tools.push(m[1].trim());
    else if (lines[i].trim()) break;
  }
  return tools;
}

/**
 * Collect the union of allowed-tools from pre-fetched Skill rows.
 * Returns an empty set if no skills declare allowed-tools.
 */
function collectSkillTools(skills: Skill[]): Set<string> {
  const tools = new Set<string>();
  let anyDeclared = false;
  for (const skill of skills) {
    if (!skill.content) continue;
    const allowed = parseAllowedTools(skill.content);
    if (allowed.length > 0) {
      anyDeclared = true;
      for (const t of allowed) tools.add(t);
    }
  }
  return anyDeclared ? tools : new Set();
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
function scopeTools(agent: Agent, available: StructuredTool[], skills: Skill[]): StructuredTool[] {
  const declared = collectSkillTools(skills);
  for (const t of agent.tools) declared.add(t);

  declared.add("list_my_runs"); // always included

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
 * Write pre-fetched skills into the PostgresStore for deepagents
 * progressive disclosure. Skills are fetched once in buildAgent() and
 * shared with both collectSkillTools() (tool scoping) and this function.
 */
async function writeSkillsToStore(skills: Skill[], store: BaseStore): Promise<void> {
  if (skills.length === 0) return;

  const now = new Date().toISOString();

  await Promise.all(
    skills
      .filter((s) => s.content)
      .map((s) =>
        store.put(["filesystem"], `/skills/${s.name}/SKILL.md`, {
          content: s.content.split("\n"),
          created_at: now,
          modified_at: now,
        }),
      ),
  );
}

// ---------------------------------------------------------------------------
// Subagent resolution
// ---------------------------------------------------------------------------

interface SubagentSpec {
  name: string;
  description: string;
  systemPrompt: string;
  tools: StructuredTool[];
  skills: string[];
  model?: LanguageModelLike;
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
  prefetched: { itemTypes: ItemType[]; lists: ListWithCount[] },
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
      // Resolve per-subagent model (if configured)
      const modelName =
        row.model_settings_key && MODEL_SETTINGS_KEYS.has(row.model_settings_key)
          ? ((settings as unknown as Record<string, unknown>)[row.model_settings_key] as
              | string
              | undefined)
          : undefined;

      const [systemPrompt, model] = await Promise.all([
        buildPrompt(row, settings, prefetched),
        modelName ? getChatModel(modelName) : Promise.resolve(undefined),
      ]);

      return {
        name: row.name,
        description: row.description,
        systemPrompt,
        tools: scopeTools(row, available, getRowSkills(row)),
        skills: row.skills.length > 0 ? ["/skills/"] : [],
        ...(model ? { model } : {}),
      } satisfies SubagentSpec;
    }),
  ]);

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


// ---------------------------------------------------------------------------
// Memory guidelines — static content injected into every prompt
// ---------------------------------------------------------------------------

const MEMORY_GUIDELINES = `<memory_guidelines>
Your memory contains your operating notes about this user — communication
preferences, behavioral patterns, quality standards, and corrections.
Update it via save_agents_md.

**Learning from interactions:**
- One of your MAIN PRIORITIES is to learn from interactions with the user.
  Learnings can be implicit or explicit.
- When you need to remember something, updating memory must be your FIRST,
  IMMEDIATE action — before responding, before calling other tools.
- When the user says something is better/worse, capture WHY and encode it
  as a pattern. Look for the underlying principle, not just the specific mistake.
- Each correction is a chance to improve permanently — don't just fix the
  immediate issue, update your operating notes.
- The user might not explicitly ask you to remember something. If they provide
  information useful for future interactions, update immediately.

**When to update memory:**
- User explicitly asks you to remember something
- User describes how you should behave or what they prefer
- User gives feedback on your work — capture what was wrong and how to improve
- You discover patterns or preferences (communication style, format preferences, workflows)
- User corrects you — save the correction AND the underlying principle

**When to NOT update memory:**
- Transient information ("I'm running late", "I'm on my phone")
- One-time task requests ("find me a recipe", "what's the weather?")
- Simple questions, small talk, acknowledgments
- Factual information about the user (preferences, facts, entities) — these
  belong as items in the database, not in memory. Use create_item instead.
- Never store API keys, passwords, or credentials

**Memory vs Items — what goes where:**
- **Memory (AGENTS.md)**: How to serve this user — communication style, quality
  standards, corrections, behavioral patterns. Operating notes that shape every
  interaction.
- **Items (create_item)**: What the user knows/wants/has — facts, preferences,
  tasks, recommendations, entities. Granular knowledge searchable via
  search_items.
- **Lists (create_list + create_item)**: Grouped items the user wants to track
  together — reading lists, grocery lists, project tasks. Use lists when the
  user describes a collection of related things.

**Examples:**
User: "I prefer bullet points over paragraphs"
→ Update memory (communication style that shapes all future responses)

User: "I love Thai food, especially pad see ew"
→ Create item (preference/learned_fact — searchable for future recommendations)

User: "Here are the movies I want to watch: Inception, Interstellar, Arrival"
→ Create list "Movies to Watch" + create items for each movie

User: "That summary was way too long, keep it to 3 bullets max"
→ Update memory (quality standard + correction: "Summaries: 3 bullets max")

User: "Remember that Tom's birthday is March 15"
→ Create item (fact about an entity — searchable, linked to Tom)

User: "Actually don't auto-archive things, always ask me first"
→ Update memory (correction: explicit boundary about agent behavior)
</memory_guidelines>`;

/**
 * Build the system prompt for any agent.
 *
 * Three layers:
 * 1. Agent prompt — agent.system_prompt (task description, agent-editable)
 * 2. Memory — AGENTS.md content + guidelines (agent-editable via save_agents_md)
 * 3. System context — capabilities, rules, reference data (deterministic, firm)
 *
 * Skill content is NOT injected — deepagents handles skill discovery via
 * the /skills/ store mount and progressive disclosure.
 */
export async function buildPrompt(
  agent: Agent,
  settings: Settings,
  prefetched?: { itemTypes?: ItemType[]; lists?: ListWithCount[] },
): Promise<string> {
  const [agentContext, itemTypes, lists] = await Promise.all([
    getAgentsMdContent(agent.name),
    prefetched?.itemTypes ?? getItemTypes(),
    prefetched?.lists ?? getAllLists({ status: 'active' }),
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

  // ── Layer 1: Agent prompt (agent-editable task description) ──
  const agentPrompt = agent.system_prompt?.trim() || (() => {
    console.warn(`[buildPrompt] Agent "${agent.name}" has no system_prompt — using generic fallback`);
    return `You are ${agent.name}, an Edda agent.`;
  })();

  // ── Layer 2: Memory (AGENTS.md + guidelines) ──
  // Only include MEMORY_GUIDELINES when the agent can actually update memory.
  // Cron-only agents (maintenance, memory) never interact with users and lack
  // save_agents_md, so the ~500-token guidelines would waste context.
  const hasMemoryTools =
    agent.skills?.includes("self_improvement") ||
    agent.skills?.includes("context_refresh") ||
    agent.tools?.includes("save_agents_md");

  const memorySection = agentContext
    ? `\n\n## Memory\n\n<agent_memory>\n${agentContext}\n</agent_memory>${hasMemoryTools ? `\n\n${MEMORY_GUIDELINES}` : ""}`
    : hasMemoryTools
      ? `\n\n## Memory\n\n<agent_memory>\n(No operating notes yet — will learn from interactions)\n</agent_memory>\n\n${MEMORY_GUIDELINES}`
      : "";

  // ── Layer 3: System context (deterministic, firm) ──

  // Delegation guidance — only when agent has both run_agent and subagents
  const hasRunAgent =
    agent.tools.includes("run_agent") || agent.tools.length === 0;
  const hasSubagents = agent.subagents.length > 0;
  const delegationLine =
    hasRunAgent && hasSubagents
      ? `\n- Delegation: \`task\` (synchronous subagent, returns result inline) vs \`run_agent\` (background job, returns task_run_id)`
      : "";

  const capabilities = `\n\n## Capabilities
- Store: write durable output to /store/ using write_file (e.g. /store/${today}, /store/latest). Read past output via read_file /store/.
- Skills: task-specific instructions loaded on demand from /skills/${delegationLine}`;

  const rules = `\n\n## Rules
- Approval required: new types (${settings.approval_new_type}), archive stale (${settings.approval_archive_stale}), entity merges (${settings.approval_merge_entity})
- Always search before creating duplicate items
- AGENTS.md token budget: ${settings.agents_md_token_budget}
- Use recall/search_items for specific facts — AGENTS.md is for operating patterns, not data`;

  const context = `\n\n## Context
- Today: ${currentDate}, ${currentTime}
- Timezone: ${settings.user_timezone}
${settings.user_display_name ? `- User: ${settings.user_display_name}` : ""}`;

  const itemTypesSection = `\n\n## Available Item Types
${formatItemTypes(itemTypes)}`;

  const commonMetadata = `\n\n## Common Metadata Fields
Any item can carry these metadata fields regardless of type:
- **recommended_by**: Who recommended or suggested this
- **url**: Associated URL or link
- **category**: Classification (movie, book, restaurant, tool, podcast)
- **priority**: low | medium | high
- **location**: Associated place
- **rating**: 1–5 rating
- **source**: Where this came from (podcast name, article, conversation)

Use these consistently across all item types. For example, a note on a "Movies to Watch"
list might have metadata: {recommended_by: "Tom", category: "movie", source: "dinner conversation"}.`;

  const listsSection = lists.length > 0
    ? `\n\n## Active Lists\n${lists.map(l =>
        `- ${l.icon} **${l.name}** (id: ${l.id})${l.summary ? ` — ${l.summary}` : ''} (${l.item_count} items)`
      ).join("\n")}`
    : '';

  return `${agentPrompt}${memorySection}${capabilities}${rules}${context}${itemTypesSection}${commonMetadata}${listsSection}`;
}

// ---------------------------------------------------------------------------
// Thread ID resolver
// ---------------------------------------------------------------------------

export function resolveThreadId(
  agent: Agent,
  channel?: { platform: string; external_id: string },
): string {
  const channelSuffix =
    agent.thread_scope === "per_channel" && channel
      ? `-${channel.platform}:${channel.external_id}`
      : "";

  const today = new Date().toISOString().split("T")[0];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DeepAgent's generic type is too complex for tsc
export async function buildAgent(agent: Agent): Promise<any> {
  const settings = await getSettings();

  // 1. Model — per-agent override via model_settings_key
  const modelName =
    agent.model_settings_key && MODEL_SETTINGS_KEYS.has(agent.model_settings_key)
      ? ((settings as unknown as Record<string, unknown>)[agent.model_settings_key] as
          | string
          | undefined)
      : undefined;

  // 2. Gather ALL available tools + prompt data + skills in one parallel batch
  const [
    model,
    searchTool,
    checkpointer,
    store,
    mcpTools,
    communityTools,
    itemTypes,
    lists,
    skills,
  ] = await Promise.all([
    getChatModel(modelName),
    getSearchTool(),
    getCheckpointer(),
    getStore(),
    loadMCPTools(),
    loadCommunityTools(),
    getItemTypes(),
    getAllLists({ status: 'active' }),
    agent.skills.length > 0 ? getSkillsByNames(agent.skills) : ([] as Skill[]),
  ]);

  const allAvailable = [
    ...allTools,
    ...mcpTools,
    ...communityTools,
    ...(searchTool ? [searchTool] : []),
  ];

  // 3. Scope tools via skills' allowed-tools + agent.tools[]; empty = list_my_runs only
  const tools = scopeTools(agent, allAvailable, skills);

  // 4. Duplicate check
  assertNoDuplicateTools(tools);

  // 5. Subagents (any agent can have them)
  const subagents =
    agent.subagents.length > 0
      ? await resolveSubagents(agent.subagents, allAvailable, store, settings, {
          itemTypes,
          lists,
        })
      : [];

  // 6. Write this agent's scoped SKILL.md files into the store
  await writeSkillsToStore(skills, store);

  // 7. System prompt — three-layer builder (agent prompt + memory + system context)
  const systemPrompt = await buildPrompt(agent, settings, { itemTypes, lists });

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
