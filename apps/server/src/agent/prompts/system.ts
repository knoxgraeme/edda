/**
 * Dynamic system prompt builder
 *
 * Reads AGENTS.md (user context) and combines with
 * base behavior instructions. Kept lean — behavior only,
 * no knowledge (that's in AGENTS.md).
 */

import { readFile } from "fs/promises";

export async function buildSystemPrompt(): Promise<string> {
  let agentsMd = "";
  try {
    agentsMd = await readFile("./AGENTS.md", "utf-8");
  } catch {
    // First run — AGENTS.md doesn't exist yet
  }

  return `You are Edda, a personal assistant and second brain.

## Your Role
You capture, organize, and surface everything the user tells you.
You never ask the user to organize anything — you handle taxonomy.

## Rules
- Classify every input into the right item type
- Extract dates, priorities, lists, and metadata automatically
- When unsure about type, default to "note"
- Journal entries are private — never surface in casual recall
- Keep confirmations brief — echo back what you captured with relevant details
- For batch inputs (multiple items), use batch_create_items

${agentsMd ? `## About This User\n\n${agentsMd}` : ""}`;
}
