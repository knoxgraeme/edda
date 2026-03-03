/**
 * Lazy Tool Injection Middleware
 *
 * Reduces token usage by only including skill-specific tools after the agent
 * has read that skill's SKILL.md. Core tools (from agent.tools[]) and
 * deepagents built-in tools are always available.
 *
 * How it works:
 * 1. afterModel: when the model generates a read_file call to a SKILL.md,
 *    marks that skill as "activated" in state
 * 2. wrapModelCall: filters `request.tools` to only include:
 *    - Core tools (from agent.tools[] DB field)
 *    - Tools from activated skills
 *    - Any tool not in the skill-to-tools mapping (deepagents built-in tools)
 */

import { createMiddleware } from "langchain";
import { z } from "zod";
import { getLogger } from "../../logger.js";

export interface SkillToolMapping {
  /** Map from skill name to its allowed tool names */
  skillToTools: Map<string, Set<string>>;
  /** Core tool names (always available, from agent.tools[]) */
  coreTools: Set<string>;
}

/**
 * Set of all Edda tool names that are managed by the lazy loading system.
 * Any tool whose name appears in ANY skill's allowed-tools is "managed" —
 * it will only be sent to the model if its skill is activated or it's a core tool.
 */
function buildManagedToolNames(mapping: SkillToolMapping): Set<string> {
  const managed = new Set<string>();
  for (const tools of mapping.skillToTools.values()) {
    for (const t of tools) managed.add(t);
  }
  return managed;
}

const SKILL_PATH_RE = /^\/skills\/([^/]+)\/SKILL\.md$/;

export function createLazyToolsMiddleware(mapping: SkillToolMapping) {
  const managedTools = buildManagedToolNames(mapping);
  const logger = getLogger();

  return createMiddleware({
    name: "LazyToolsMiddleware",
    stateSchema: z.object({
      activatedSkills: z.array(z.string()).default([]),
    }),

    afterModel: (state) => {
      // Check if any read_file tool calls target a SKILL.md
      const messages = state.messages ?? [];
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls = (lastMsg as any).tool_calls as
        | Array<{ name: string; args: Record<string, unknown> }>
        | undefined;
      if (!toolCalls) return;

      const current = new Set(state.activatedSkills ?? []);
      let changed = false;

      for (const tc of toolCalls) {
        if (tc.name === "read_file") {
          const path = tc.args?.path as string | undefined;
          if (path) {
            const match = SKILL_PATH_RE.exec(path);
            if (match && !current.has(match[1])) {
              current.add(match[1]);
              changed = true;
              logger.debug({ skill: match[1] }, "Lazy tools: skill activated");
            }
          }
        }
      }

      if (changed) {
        return { activatedSkills: [...current] };
      }
    },

    wrapModelCall: async (request, handler) => {
      const activated = new Set(request.state.activatedSkills ?? []);

      // Build the set of allowed tool names for this call
      const allowedNames = new Set(mapping.coreTools);
      for (const skillName of activated) {
        const skillTools = mapping.skillToTools.get(skillName);
        if (skillTools) {
          for (const t of skillTools) allowedNames.add(t);
        }
      }

      // Filter: keep tool if it's allowed, OR if it's not managed (deepagents built-in)
      const filteredTools = request.tools.filter((t) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const name = (t as any).name as string | undefined;
        if (!name) return true; // keep unknown tools
        return allowedNames.has(name) || !managedTools.has(name);
      });

      if (logger.isLevelEnabled("debug")) {
        logger.debug(
          {
            total: request.tools.length,
            filtered: filteredTools.length,
            activated: [...activated],
          },
          "Lazy tools: filtered tools for model call",
        );
      }

      return handler({ ...request, tools: filteredTools });
    },
  });
}
