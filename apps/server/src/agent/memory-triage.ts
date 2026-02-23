/**
 * Memory Triage — AfterAgent hotpatch for memory files
 *
 * Called from the post-process middleware after each conversation.
 * Checks if entities mentioned in the conversation have existing memory files,
 * and if the conversation contains contradictions or significant new info,
 * triggers a lightweight LLM call to update the brief.
 */

import { z } from "zod";
import { getSettingsSync } from "@edda/db";
import type { EntityType } from "@edda/db";
import { getChatModel } from "../llm/index.js";
import { getStore } from "../store/index.js";
import { entityToMemoryKey, ENTITY_TYPE_TO_DIR } from "./memory-paths.js";
import type { MemoryFileRecord } from "./memory-paths.js";
import { buildTranscript } from "./message-helpers.js";
import type { MessageLike } from "./message-helpers.js";

// ── Zod schema for structured triage decision ────────────────────

const TriageDecisionSchema = z.object({
  updates: z.array(
    z.object({
      entity_name: z.string(),
      reason: z
        .enum(["contradiction", "significant_new_info"])
        .describe("Why this memory file needs updating"),
      updated_content: z
        .string()
        .describe("The full updated memory file content (markdown)"),
    }),
  ),
});

// ── Main entry point ─────────────────────────────────────────────

/**
 * Check if any entities mentioned in the conversation have memory files
 * that need hotpatching due to contradictions or significant new info.
 *
 * Called from post-process middleware after maybeRefreshAgentsMd().
 * Accepts entities already extracted by the post-process pipeline to
 * avoid redundant embedding + entity search calls.
 */
export async function maybeHotpatchMemoryFiles(
  messages: MessageLike[],
  extractedEntities: Array<{ name: string; type: string }>,
): Promise<void> {
  if (!messages || messages.length < 2) return;
  if (extractedEntities.length === 0) return;

  const settings = getSettingsSync();
  if (!settings.memory_extraction_enabled) return;

  const store = await getStore();

  // 1. Build transcript
  const transcript = buildTranscript(messages);
  if (transcript.length < 100) return;

  // 2. Check which extracted entities have memory files (parallel reads)
  const entityChecks = extractedEntities
    .map((entity) => {
      const memKey = entityToMemoryKey(entity.name, entity.type as EntityType);
      if (!memKey) return null;
      return { entity, memKey };
    })
    .filter(Boolean) as Array<{
    entity: { name: string; type: string };
    memKey: string;
  }>;

  if (entityChecks.length === 0) return;

  const checkResults = await Promise.all(
    entityChecks.map(async ({ entity, memKey }) => {
      try {
        const item = await store.get(["filesystem"], memKey);
        if (item && item.value) {
          const content = Array.isArray(item.value.content)
            ? (item.value.content as string[]).join("\n")
            : String(item.value.content ?? "");
          if (content) {
            return {
              name: entity.name,
              type: entity.type as EntityType,
              memoryKey: memKey,
              memoryContent: content,
              originalCreatedAt: (item.value.created_at as string) ?? null,
            };
          }
        }
      } catch {
        // Memory file doesn't exist — skip
      }
      return null;
    }),
  );

  const entitiesWithMemory = checkResults.filter(Boolean) as Array<{
    name: string;
    type: EntityType;
    memoryKey: string;
    memoryContent: string;
    originalCreatedAt: string | null;
  }>;

  if (entitiesWithMemory.length === 0) return;

  // 3. Call LLM to decide if hotpatch is needed
  const model = await getChatModel(settings.memory_sync_model);
  const structuredModel = model.withStructuredOutput(TriageDecisionSchema, {
    name: "triage_decision",
  });

  const entityContext = entitiesWithMemory
    .map(
      (e) =>
        `### ${e.name} (${e.type})\nMemory file path: /memories${e.memoryKey}\nCurrent content:\n${e.memoryContent}`,
    )
    .join("\n\n");

  const result = await structuredModel.invoke([
    {
      role: "system" as const,
      content: `You are a memory triage agent. Compare the conversation against existing memory files and decide if any need updating.

Only update a memory file if:
1. The conversation CONTRADICTS something in the memory file (e.g., "Sarah switched jobs" when the memory says she works at OldCo)
2. The conversation reveals SIGNIFICANT new information not in the memory file (not minor mentions)

Do NOT update for:
- Minor mentions or reinforcements of existing info
- Tangential references to the entity
- Information already captured in the memory file

If updating, provide the full updated content (not a diff). Preserve existing info that's still accurate and add the new info.

## Existing Memory Files
${entityContext}`,
    },
    {
      role: "user" as const,
      content: `## Conversation Transcript\n${transcript}`,
    },
  ]);

  const decision = result as z.infer<typeof TriageDecisionSchema>;
  if (!decision.updates || decision.updates.length === 0) return;

  // 4. Apply hotpatches
  const now = new Date().toISOString();
  for (const update of decision.updates) {
    const entity = entitiesWithMemory.find(
      (e) => e.name.toLowerCase() === update.entity_name.toLowerCase(),
    );
    if (!entity) continue;

    const record: MemoryFileRecord = {
      content: update.updated_content.split("\n"),
      created_at: entity.originalCreatedAt ?? now,
      modified_at: now,
      memory_type: ENTITY_TYPE_TO_DIR[entity.type] ?? entity.type,
      source: "hotpatch",
    };

    await store.put(["filesystem"], entity.memoryKey, record);

    console.log(
      `[memory-triage] Hotpatched ${entity.memoryKey}: ${update.reason}`,
    );
  }
}
