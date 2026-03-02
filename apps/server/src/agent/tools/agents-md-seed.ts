/**
 * Shared constant for the empty AGENTS.md seed template.
 *
 * Used by create-agent.ts (to write the seed) and seed-agents-md.ts
 * (to detect whether the seed has been customized).
 */

export const EMPTY_AGENTS_MD_SEED = [
  "## Communication",
  "(Learning — will update as I observe your preferences)",
  "",
  "## Patterns",
  "(No patterns observed yet)",
  "",
  "## Standards",
  "(No specific standards established yet)",
  "",
  "## Corrections",
  "(No corrections yet)",
].join("\n");

export function isEmptyAgentsMdSeed(content: string): boolean {
  return content.trim() === EMPTY_AGENTS_MD_SEED.trim();
}
