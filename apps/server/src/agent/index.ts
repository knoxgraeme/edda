/**
 * Agent factory — creates the Edda deep agent
 *
 * Uses getChatModel(), getSearchTool(), getCheckpointer() factories
 * which read from the settings table (with env var override support).
 */

import { createDeepAgent, StateBackend, StoreBackend, CompositeBackend } from "deepagents";
import { getCheckpointer } from "../checkpointer/index.js";
import { getChatModel } from "../llm/index.js";
import { getSearchTool } from "../search/index.js";
import { getStore } from "../store/index.js";
import { loadMCPTools } from "./mcp.js";
import { buildSystemPrompt } from "./prompts/system.js";
import { eddaTools } from "./tools/index.js";

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
    ...eddaTools,
    ...additionalTools,
    ...mcpTools,
    ...(searchTool ? [searchTool] : []),
  ];

  // P1: Assert no tool name collisions (MCP tools could shadow built-in tools)
  const toolNames = tools.map((t) => t.name);
  const seen = new Set<string>();
  for (const name of toolNames) {
    if (seen.has(name)) {
      throw new Error(`Duplicate tool name detected: "${name}". MCP tools must not shadow built-in tools.`);
    }
    seen.add(name);
  }

  return createDeepAgent({
    name: "edda",
    model,
    tools,
    systemPrompt,
    checkpointer,
    store,
    backend: (rt) =>
      new CompositeBackend(new StateBackend(rt), {
        "/memories/": new StoreBackend(rt),
        "/skills/": new StoreBackend(rt),
      }),
    skills: ["/skills/"],
  });
}
