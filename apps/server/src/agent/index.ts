/**
 * Agent factory — creates the Edda deep agent
 *
 * Uses getChatModel(), getSearchTool(), getCheckpointer() factories
 * which read from the settings table (with env var override support).
 */

import { createDeepAgent, StateBackend, StoreBackend, CompositeBackend } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import { getAgentByName } from "@edda/db";
import { getCheckpointer } from "../checkpointer/index.js";
import { getChatModel } from "../llm/index.js";
import { getSearchTool } from "../search/index.js";
import { getStore } from "../store/index.js";
import { loadMCPTools } from "./mcp.js";
import { buildSystemPrompt } from "./prompts/system.js";
import { allTools } from "./tools/index.js";
import { AgentOutputBackend } from "./agent-output-backend.js";
import { loadSkillContent, collectSkillTools } from "./skill-loader.js";

// ---------------------------------------------------------------------------
// DB-driven subagent resolution
// ---------------------------------------------------------------------------

type SubagentSpec = {
  name: string;
  description: string;
  systemPrompt: string;
  tools: StructuredTool[];
};

/**
 * Resolve subagent definitions from the DB using the same skill/tool logic as buildAgent().
 * Each subagent's tools come from its skills' allowed-tools frontmatter + agent.tools[].
 */
async function resolveSubagents(
  names: string[],
  availableTools: StructuredTool[],
): Promise<SubagentSpec[]> {
  const specs: SubagentSpec[] = [];

  for (const name of names) {
    const row = await getAgentByName(name);
    if (!row || !row.enabled) continue;

    const skillContent = row.skills
      .map((s) => {
        try {
          return loadSkillContent(s);
        } catch (err) {
          console.error(
            `[resolveSubagents] Failed to load skill "${s}" for agent "${row.name}":`,
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      })
      .filter(Boolean)
      .join("\n\n---\n\n");

    const prompt = row.system_prompt || skillContent || `You are ${row.name}.`;

    // Resolve tools using the same additive logic as buildAgent
    const toolNames = collectSkillTools(row.skills);
    for (const t of row.tools) toolNames.add(t);
    let tools: StructuredTool[];
    if (toolNames.size > 0) {
      tools = availableTools.filter((t) => toolNames.has(t.name));
    } else {
      console.warn(
        `[resolveSubagents] Subagent "${row.name}" has no declared tools — mounting with empty tool set.`,
      );
      tools = [];
    }

    specs.push({ name: row.name, description: row.description, systemPrompt: prompt, tools });
  }

  return specs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createEddaAgent(additionalTools: any[] = []): Promise<any> {
  const [model, searchTool, checkpointer, systemPrompt, mcpTools, store] = await Promise.all([
    getChatModel(),
    getSearchTool(),
    getCheckpointer(),
    buildSystemPrompt(),
    loadMCPTools(),
    getStore(),
  ]);

  const tools = [
    ...allTools,
    ...additionalTools,
    ...mcpTools,
    ...(searchTool ? [searchTool] : []),
  ];

  // P1: Assert no tool name collisions (MCP tools could shadow built-in tools)
  const toolNameList = tools.map((t) => t.name);
  const seen = new Set<string>();
  for (const name of toolNameList) {
    if (seen.has(name)) {
      throw new Error(
        `Duplicate tool name detected: "${name}". MCP tools must not shadow built-in tools.`,
      );
    }
    seen.add(name);
  }

  // Resolve subagents from DB (fall back to known defaults if no edda row)
  const eddaRow = await getAgentByName("edda");
  const subagentNames = eddaRow?.subagents ?? ["memory_writer"];
  const subagents = await resolveSubagents(subagentNames, allTools);

  return createDeepAgent({
    name: "edda",
    model,
    tools,
    systemPrompt,
    checkpointer,
    store,
    backend: (rt) =>
      new CompositeBackend(new StateBackend(rt), {
        "/skills/": new StoreBackend(rt),
        "/output/": new AgentOutputBackend(rt),
      }),
    skills: ["/skills/"],
    subagents,
  });
}
