/**
 * Agent factory — creates the Edda deep agent
 *
 * Uses getChatModel(), getSearchTool(), getCheckpointer() factories
 * which read from the settings table (with env var override support).
 */

import { getSettingsSync } from "@edda/db";
import type { StructuredTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { getCheckpointer } from "../checkpointer/index.js";
import { getChatModel } from "../llm/index.js";
import { getSearchTool } from "../search/index.js";
import { loadMCPTools } from "./mcp.js";
import { buildSystemPrompt } from "./prompts/system.js";
import { eddaTools } from "./tools/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createEddaAgent(): Promise<any> {
  const settings = getSettingsSync();

  const model = getChatModel(settings.default_model);
  const searchTool = getSearchTool(settings.web_search_max_results);

  const [checkpointer, systemPrompt, mcpTools] = await Promise.all([
    getCheckpointer() as Promise<BaseCheckpointSaver>,
    buildSystemPrompt(),
    loadMCPTools(),
  ]);

  const tools: StructuredTool[] = [
    ...eddaTools,
    ...mcpTools,
    ...(searchTool ? [searchTool as StructuredTool] : []),
  ];

  const agent = createDeepAgent({
    name: "edda",
    model,
    tools,
    systemPrompt,
    checkpointer,
  });

  return agent;
}
