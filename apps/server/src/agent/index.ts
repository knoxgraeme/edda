/**
 * Agent factory — creates the Edda deep agent
 *
 * Uses getChatModel(), getSearchTool(), getCheckpointer() factories
 * which read from the settings table (with env var override support).
 */

import { getSettingsSync } from "@edda/db";
import { getChatModel } from "../llm/index.js";
import { getSearchTool } from "../search/index.js";
import { getCheckpointer } from "../checkpointer/index.js";
// import { createDeepAgent } from "deepagents";
// import { EddaPostProcessMiddleware } from "./middleware/post-process.js";
// import { eddaTools } from "./tools/index.js";
// import { buildSystemPrompt } from "./prompts/system.js";

export async function createEddaAgent() {
  const settings = getSettingsSync();

  const model = getChatModel(settings.default_model);
  const searchTool = getSearchTool(settings.web_search_max_results);
  const checkpointer = await getCheckpointer();

  // TODO: Wire up deep agent creation
  // const agent = createDeepAgent({
  //   model,
  //   checkpointer,
  //   tools: [...eddaTools, ...(searchTool ? [searchTool] : [])],
  //   systemPrompt: buildSystemPrompt,
  //   middleware: [
  //     new EddaPostProcessMiddleware(),
  //     toolCallLimitMiddleware({ runLimit: settings.tool_call_limit_global }),
  //   ],
  // });

  return { model, searchTool, checkpointer };
}
