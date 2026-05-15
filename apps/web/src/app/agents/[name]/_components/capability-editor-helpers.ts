/**
 * Pure helpers backing the capability editor sheet.
 *
 * Kept in a zero-dependency module (no React, no UI deps) so the
 * non-trivial selection logic can be unit-tested without stubbing the
 * entire React/Radix/Lucide import graph.
 */
import type { Agent } from "../../../types/db";
import { AVAILABLE_SKILLS, AVAILABLE_TOOL_GROUPS } from "../../constants";

export type CapabilityKind = "skills" | "tools" | "subagents";

/**
 * Full option set shown in the editor. For tools, any custom/unknown
 * tool names currently on the agent are appended after the known ones
 * so the user can still see and deselect them.
 */
export function allOptions(
  kind: CapabilityKind,
  agent: Agent,
  availableAgents: string[],
): string[] {
  if (kind === "skills") return AVAILABLE_SKILLS.map((s) => s.name);
  if (kind === "tools") {
    const known = AVAILABLE_TOOL_GROUPS.flatMap((g) => g.tools);
    const unknown = agent.tools.filter((t) => !known.includes(t));
    return [...known, ...unknown];
  }
  return availableAgents;
}

/** Current selection for a capability kind from the agent record. */
export function currentSelection(kind: CapabilityKind, agent: Agent): string[] {
  if (kind === "skills") return agent.skills;
  if (kind === "tools") return agent.tools;
  return agent.subagents;
}
