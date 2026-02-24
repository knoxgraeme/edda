/**
 * Channel agent builder — creates standalone deep agents from AgentDefinition rows.
 *
 * Each channel agent gets:
 * - A scoped tool set based on its skills (read-only, reporter, or memory-writer)
 * - Its own AGENTS.md context (agent-specific or shared)
 * - A thread ID derived from its context_mode (isolated, daily, persistent)
 * - Optional /output/ StoreBackend mount for channel output
 * - get_my_history tool for self-awareness of past runs
 */

import { randomUUID } from "node:crypto";
import { createDeepAgent, StateBackend, StoreBackend, CompositeBackend } from "deepagents";
import type { AgentDefinition, Settings } from "@edda/db";
import { getSettings, getAgentsMdContent } from "@edda/db";
import { getChatModel } from "../llm/index.js";
import { getCheckpointer } from "../checkpointer/index.js";
import { getStore } from "../store/index.js";
import { loadSkillContent } from "./skill-loader.js";
import { getMyHistoryTool } from "./tools/get-my-history.js";

// -- Tool imports (scoped profiles) --
import { createItemTool } from "./tools/create-item.js";
import { updateItemTool } from "./tools/update-item.js";
import { deleteItemTool } from "./tools/delete-item.js";
import { searchItemsTool } from "./tools/search-items.js";
import { upsertEntityTool } from "./tools/upsert-entity.js";
import { getEntityItemsTool } from "./tools/get-entity-items.js";
import { linkItemEntityTool } from "./tools/link-item-entity.js";
import { markThreadProcessedTool } from "./tools/mark-thread-processed.js";
import { getAgentKnowledgeTool } from "./tools/get-agent-knowledge.js";
import { getItemByIdTool } from "./tools/get-item-by-id.js";
import { getUnprocessedThreadsTool } from "./tools/get-unprocessed-threads.js";
import { getThreadMessagesTool } from "./tools/get-thread-messages.js";
import { listThreadsTool } from "./tools/list-threads.js";
import { getDashboardTool } from "./tools/get-dashboard.js";
import { getTimelineTool } from "./tools/get-timeline.js";
import { getListItemsTool } from "./tools/get-list-items.js";
import { batchCreateItemsTool } from "./tools/batch-create-items.js";
import { createItemTypeTool } from "./tools/create-item-type.js";

// -- Tool profiles --

const READ_ONLY_TOOLS = [
  searchItemsTool,
  getItemByIdTool,
  getEntityItemsTool,
  getAgentKnowledgeTool,
  getDashboardTool,
  getTimelineTool,
  getListItemsTool,
];

const REPORTER_TOOLS = [...READ_ONLY_TOOLS, createItemTool, batchCreateItemsTool];

const MEMORY_WRITER_TOOLS = [
  ...REPORTER_TOOLS,
  updateItemTool,
  deleteItemTool,
  upsertEntityTool,
  linkItemEntityTool,
  getUnprocessedThreadsTool,
  getThreadMessagesTool,
  listThreadsTool,
  markThreadProcessedTool,
];

/** User-defined agents get full data access but no admin/orchestration tools. */
const USER_AGENT_TOOLS = [
  ...MEMORY_WRITER_TOOLS,
  createItemTypeTool,
];

// -- Tool selection --

function getToolsForDefinition(definition: AgentDefinition) {
  let baseTools;
  if (
    definition.skills.some((s) =>
      ["post_process", "memory_extraction", "weekly_reflect"].includes(s),
    )
  ) {
    baseTools = MEMORY_WRITER_TOOLS;
  } else if (definition.skills.some((s) => ["daily_digest", "type_evolution"].includes(s))) {
    baseTools = [...REPORTER_TOOLS, createItemTypeTool];
  } else {
    baseTools = USER_AGENT_TOOLS;
  }

  return [...baseTools, getMyHistoryTool];
}

// -- Backend builder --

function buildBackend(definition: AgentDefinition) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rt: { state: unknown; store?: any }) => {
    const hasChannelOutput =
      definition.output_mode === "channel" || definition.output_mode === "both";

    if (!hasChannelOutput) {
      return new StateBackend(rt);
    }

    // Mount /output/ as a StoreBackend scoped to this agent's channel namespace.
    // Store namespace: [agentName, "filesystem", ...] — agents use write_file/read_file
    // naturally. The orchestrator's TaskChannelBackend reads the same namespace.
    return new CompositeBackend(new StateBackend(rt), {
      "/output/": new StoreBackend({ ...rt, assistantId: definition.name }),
    });
  };
}

// -- Prompt builder --

async function buildAgentPrompt(definition: AgentDefinition, settings: Settings): Promise<string> {
  const skillContent = definition.skills
    .map((s) => {
      try {
        return loadSkillContent(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  const base =
    definition.system_prompt ||
    skillContent ||
    `You are ${definition.name}, an Edda background agent.`;

  const agentContext = await getAgentsMdContent(definition.name);
  const contextSection = agentContext ? `\n\n## Your Context\n${agentContext}` : "";

  // Channel output instructions for agents with /output/ mount
  const hasOutput = definition.output_mode === "channel" || definition.output_mode === "both";
  const today = new Date().toISOString().split("T")[0];
  const outputSection = hasOutput
    ? `\n\n## Output
Write your results to /output/ using write_file. For example:
- write_file /output/${today} — today's output
- write_file /output/latest — most recent summary
You can also read your past output via read_file /output/.`
    : "";

  const settingsContext = `
## Context
- Today: ${today}
- Timezone: ${settings.user_timezone}
${settings.user_display_name ? `- User: ${settings.user_display_name}` : ""}`;

  return `${base}${contextSection}${outputSection}\n\n${settingsContext}`;
}

// -- Thread ID resolver --

export function resolveThreadId(definition: AgentDefinition): string {
  const today = new Date().toISOString().split("T")[0];
  switch (definition.context_mode) {
    case "isolated":
      return `task-${definition.name}-${randomUUID()}`;
    case "daily":
      return `task-${definition.name}-${today}`;
    case "persistent":
      return `task-${definition.name}`;
  }
}

// -- Model settings key allowlist --

export const MODEL_SETTINGS_KEYS = new Set([
  "default_model",
  "daily_digest_model",
  "memory_extraction_model",
  "weekly_review_model",
  "type_evolution_model",
  "context_refresh_model",
  "user_cron_model",
  "memory_sync_model",
]);

// -- Agent builder --

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildChannelAgent(definition: AgentDefinition): Promise<any> {
  const settings = await getSettings();
  const modelName =
    definition.model_settings_key && MODEL_SETTINGS_KEYS.has(definition.model_settings_key)
      ? ((settings as unknown as Record<string, unknown>)[definition.model_settings_key] as
          | string
          | undefined)
      : undefined;

  const [model, checkpointer, store] = await Promise.all([
    getChatModel(modelName),
    getCheckpointer(),
    getStore(),
  ]);

  const tools = getToolsForDefinition(definition);
  const systemPrompt = await buildAgentPrompt(definition, settings);

  return createDeepAgent({
    name: definition.name,
    model,
    tools,
    systemPrompt,
    checkpointer,
    store,
    backend: buildBackend(definition),
  });
}
