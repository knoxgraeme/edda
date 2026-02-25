/**
 * Agent builder — creates standalone deep agents from Agent rows.
 *
 * Each agent gets:
 * - A scoped tool set derived from skill allowed-tools + agent.tools[] (additive)
 * - Its own AGENTS.md context (agent-specific or shared)
 * - A thread ID derived from its context_mode (isolated, daily, persistent)
 * - /output/ StoreBackend mount for agent output
 * - get_my_history tool for self-awareness of past runs
 */

import { randomUUID } from "node:crypto";
import { createDeepAgent, StateBackend, StoreBackend, CompositeBackend } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import type { Agent, Settings } from "@edda/db";
import { getSettings, getAgentsMdContent } from "@edda/db";
import { getChatModel } from "../llm/index.js";
import { getCheckpointer } from "../checkpointer/index.js";
import { getStore } from "../store/index.js";
import { loadSkillContent, collectSkillTools } from "./skill-loader.js";
import { allTools } from "./tools/index.js";

const TOOLS_BY_NAME = new Map<string, StructuredTool>(allTools.map((t) => [t.name, t]));

// -- Tool selection --

/**
 * Determine the tool set for an agent.
 *
 * Tool resolution (additive):
 * 1. Collect allowed-tools from all of the agent's skills (union)
 * 2. Add any individual tool names from agent.tools[]
 * 3. Filter allTools to only those in the resolved set
 * 4. Always include get_my_history
 *
 * If no tools are declared (no skill declares allowed-tools AND agent.tools is empty),
 * all tools are returned (backward compatible).
 */
function getToolsForAgent(agent: Agent): StructuredTool[] {
  const skillTools = collectSkillTools(agent.skills);

  const resolved = new Set(skillTools);
  for (const entry of agent.tools) {
    resolved.add(entry);
  }

  // No restrictions declared — return all tools
  if (resolved.size === 0) return allTools;

  // Always include get_my_history
  resolved.add("get_my_history");

  const tools: StructuredTool[] = [];
  for (const name of resolved) {
    const tool = TOOLS_BY_NAME.get(name);
    if (tool) tools.push(tool);
  }
  return tools;
}

// -- Backend builder --

function buildBackend(agent: Agent) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rt: { state: unknown; store?: any }) => {
    // Always mount /output/ as a StoreBackend scoped to this agent's namespace.
    // The orchestrator's AgentOutputBackend reads the same namespace.
    return new CompositeBackend(new StateBackend(rt), {
      "/output/": new StoreBackend({ ...rt, assistantId: agent.name }),
    });
  };
}

// -- Prompt builder --

async function buildAgentPrompt(agent: Agent, settings: Settings): Promise<string> {
  const skillContent = agent.skills
    .map((s) => {
      try {
        return loadSkillContent(s);
      } catch (err) {
        console.error(
          `[buildAgent] Failed to load skill "${s}" for agent "${agent.name}":`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  if (skillContent.length === 0 && agent.skills.length > 0 && !agent.system_prompt) {
    throw new Error(
      `Agent "${agent.name}" has ${agent.skills.length} skill(s) configured but none could be loaded. ` +
        `Check that SKILL.md files exist in the skills/ directory.`,
    );
  }

  const base =
    agent.system_prompt || skillContent || `You are ${agent.name}, an Edda background agent.`;

  const [agentContext] = await Promise.all([getAgentsMdContent(agent.name)]);
  const contextSection = agentContext ? `\n\n## Your Context\n${agentContext}` : "";

  // Output instructions — all agents have /output/ mount
  const today = new Date().toISOString().split("T")[0];
  const outputSection = `\n\n## Output
Write your results to /output/ using write_file. For example:
- write_file /output/${today} — today's output
- write_file /output/latest — most recent summary
You can also read your past output via read_file /output/.`;

  const settingsContext = `
## Context
- Today: ${today}
- Timezone: ${settings.user_timezone}
${settings.user_display_name ? `- User: ${settings.user_display_name}` : ""}`;

  return `${base}${contextSection}${outputSection}\n\n${settingsContext}`;
}

// -- Thread ID resolver --

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

// -- Model settings key allowlist --

export const MODEL_SETTINGS_KEYS = new Set([
  "default_model",
  "daily_digest_model",
  "memory_catchup_model",
  "weekly_review_model",
  "type_evolution_model",
  "context_refresh_model",
]);

// -- Agent builder --

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildAgent(agent: Agent): Promise<any> {
  const settings = await getSettings();
  const modelName =
    agent.model_settings_key && MODEL_SETTINGS_KEYS.has(agent.model_settings_key)
      ? ((settings as unknown as Record<string, unknown>)[agent.model_settings_key] as
          | string
          | undefined)
      : undefined;

  const [model, checkpointer, store] = await Promise.all([
    getChatModel(modelName),
    getCheckpointer(),
    getStore(),
  ]);

  const tools = getToolsForAgent(agent);
  const systemPrompt = await buildAgentPrompt(agent, settings);

  return createDeepAgent({
    name: agent.name,
    model,
    tools,
    systemPrompt,
    checkpointer,
    store,
    backend: buildBackend(agent),
  });
}
