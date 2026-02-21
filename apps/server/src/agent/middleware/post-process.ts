/**
 * EddaPostProcessMiddleware — afterAgent hook
 *
 * Runs after each conversation ends. Two jobs:
 * 1. Memory extraction — preferences, facts, patterns
 * 2. Entity extraction + linking — people, projects, companies
 *
 * Both happen in a single LLM call. Both go through semantic dedup
 * (pgvector cosine search) before writing.
 */

import { z } from "zod";
import {
  createItem,
  updateItem,
  searchItems,
  upsertEntity,
  updateEntity,
  searchEntities,
  linkItemEntity,
  setThreadMetadata,
  createAgentLog,
  getSettingsSync,
} from "@edda/db";
import type {
  Settings,
  EntityType,
  CreateItemInput,
  SearchResult,
  EntitySearchResult,
} from "@edda/db";
import { embed } from "../../embed/index.js";
import { getChatModel } from "../../llm/index.js";
import { generateAgentsMd } from "../generate-agents-md.js";

// ── Zod schemas for structured LLM output ──────────────────────

const MemorySchema = z.object({
  type: z.enum(["preference", "learned_fact", "pattern"]),
  content: z.string().describe("The memory to store, written as a concise statement"),
});

const ExtractedEntitySchema = z.object({
  name: z.string().describe("Canonical name (e.g. 'Sarah Chen', not 'Sarah')"),
  type: z.enum(["person", "project", "company", "topic", "place", "tool", "concept"]),
  description: z.string().optional().describe("One-line description if inferrable"),
  aliases: z.array(z.string()).optional().describe("Alternative names used in conversation"),
});

const ExtractionResultSchema = z.object({
  memories: z.array(MemorySchema).describe("Implicit knowledge extracted from the conversation"),
  entities: z
    .array(ExtractedEntitySchema)
    .describe("Named entities mentioned in the conversation"),
});

type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
type ExtractedMemory = z.infer<typeof MemorySchema>;
type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

// ── Extraction prompt ───────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a knowledge extraction system. Analyze the following conversation transcript and extract two things:

## 1. Implicit Knowledge (memories)
Extract preferences, personal facts, and behavioral patterns that the user revealed implicitly — NOT things they explicitly asked to be stored.

Examples of what TO extract:
- "prefers short confirmations over verbose responses"
- "partner's name is Emily"
- "works at Acme Corp as a senior engineer"
- "brain-dumps groceries on Thursday evenings"
- "prefers dark mode and minimal UIs"

Examples of what NOT to extract:
- Items the user explicitly asked to store (tasks, reminders, notes — the agent already saved these)
- Greetings, small talk, or meta-conversation about the assistant
- Information that is too vague or contextual to be a lasting fact

For each memory, choose the most appropriate type:
- **preference**: User likes/dislikes, communication style, workflow habits
- **learned_fact**: Personal details, relationships, work info, biographical facts
- **pattern**: Recurring behaviors, schedules, routines

## 2. Entities
Extract named entities: people, projects, companies, topics, places, tools, or concepts.
Use the canonical/full form of the name (e.g. "Sarah Chen" not just "Sarah").
Include aliases if the conversation used shorthand (e.g. aliases: ["k8s"] for "Kubernetes").

## Rules
- Be conservative. Only extract things with high confidence.
- Do not fabricate or infer beyond what the conversation clearly implies.
- If the conversation has no extractable knowledge, return empty arrays.
- Write memories as concise, third-person statements about the user.

## Conversation Transcript
`;

// ── Message type for the state we receive ───────────────────────

interface MessageLike {
  type?: string;
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
  name?: string;
  additional_kwargs?: Record<string, unknown>;
}

interface ConversationState {
  messages?: MessageLike[];
  configurable?: {
    thread_id?: string;
  };
}

// ── Helper: extract text from messages ──────────────────────────

function getMessageText(msg: MessageLike): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

function getMessageRole(msg: MessageLike): string {
  return msg.role ?? msg.type ?? "unknown";
}

function buildTranscript(messages: MessageLike[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = getMessageRole(msg);
    const text = getMessageText(msg);
    if (text.trim()) {
      lines.push(`[${role}]: ${text}`);
    }
  }
  return lines.join("\n\n");
}

// ── Helper: extract created item IDs from tool call results ─────

/**
 * Scans the message history for tool call results that contain item IDs
 * (from create_item, batch_create_items, update_item tool calls).
 */
export function extractCreatedItemIds(messages: MessageLike[]): string[] {
  const ids: string[] = [];
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  for (const msg of messages) {
    const role = getMessageRole(msg);
    // Tool results come back as "tool" type messages
    if (role !== "tool") continue;

    const text = getMessageText(msg);
    if (!text) continue;

    // Try to parse as JSON first (structured tool results)
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        // Single item result: { id: "uuid", ... }
        if (typeof parsed.id === "string" && uuidRegex.test(parsed.id)) {
          ids.push(parsed.id);
        }
        // Batch result: [ { id: "uuid" }, ... ] or { items: [ { id: "uuid" } ] }
        const items = Array.isArray(parsed) ? parsed : parsed.items;
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item && typeof item.id === "string" && uuidRegex.test(item.id)) {
              ids.push(item.id);
            }
          }
        }
      }
    } catch {
      // Not JSON — scan for UUIDs in the text
      const matches = text.match(uuidRegex);
      if (matches) {
        ids.push(...matches);
      }
    }
  }

  // Deduplicate
  return [...new Set(ids)];
}

// ── Main class ──────────────────────────────────────────────────

export class EddaPostProcessMiddleware {
  name = "edda-post-process";

  /**
   * afterAgent — runs after each conversation ends.
   *
   * 1. Build transcript from messages
   * 2. Single LLM call to extract memories + entities
   * 3. Semantic dedup for memories (embed -> cosine search -> reinforce/update/insert)
   * 4. Semantic dedup for entities (embed -> cosine search -> exact merge/fuzzy merge/new)
   * 5. Link entities to items created during the conversation
   * 6. Mark thread as processed
   * 7. Regenerate AGENTS.md
   */
  async afterAgent(state: unknown): Promise<unknown> {
    const startTime = Date.now();
    const typedState = state as ConversationState;
    const messages = typedState?.messages;
    const threadId = typedState?.configurable?.thread_id;

    // Skip if no messages or too few to extract from
    if (!messages || messages.length < 2) {
      return state;
    }

    let settings: Settings;
    try {
      settings = getSettingsSync();
    } catch {
      // Settings not loaded — skip gracefully
      return state;
    }

    // Skip if memory extraction is disabled
    if (!settings.memory_extraction_enabled) {
      // Still mark thread as processed so cron doesn't re-process
      if (threadId) {
        await this.markThreadProcessed(threadId).catch(() => {});
      }
      return state;
    }

    try {
      // 1. Build transcript
      const transcript = buildTranscript(messages);
      if (transcript.trim().length < 50) {
        // Too short to extract anything meaningful
        if (threadId) {
          await this.markThreadProcessed(threadId);
        }
        return state;
      }

      // 2. Extract memories + entities via LLM
      const extraction = await this.callExtractionLLM(transcript, settings);
      if (!extraction) {
        if (threadId) {
          await this.markThreadProcessed(threadId);
        }
        return state;
      }

      // 3. Get item IDs created during this conversation (for entity linking)
      const createdItemIds = extractCreatedItemIds(messages);

      // 4. Process memories with semantic dedup
      const { itemIds: memoryItemIds, entityIds: memoryEntityIds } =
        await this.processMemories(extraction.memories, settings);

      // 5. Process entities with semantic dedup
      const newEntityIds = await this.processEntities(extraction.entities, settings);
      const allEntityIds = [...memoryEntityIds, ...newEntityIds];

      // 6. Link entities to items created during the conversation
      await this.linkEntitiesToItems(allEntityIds, createdItemIds);

      // 7. Mark thread as processed
      if (threadId) {
        await this.markThreadProcessed(threadId);
      }

      // 8. Regenerate AGENTS.md
      await generateAgentsMd().catch((err: unknown) => {
        console.error("[post-process] Failed to regenerate AGENTS.md:", err);
      });

      // 9. Log to agent_log
      const durationMs = Date.now() - startTime;
      await createAgentLog({
        skill: "post_process",
        trigger: "afterAgent",
        input_summary: `Transcript: ${transcript.length} chars, ${messages.length} messages`,
        output_summary: `Extracted ${extraction.memories.length} memories, ${extraction.entities.length} entities`,
        items_created: memoryItemIds,
        entities_created: allEntityIds,
        duration_ms: durationMs,
      }).catch((err: unknown) => {
        console.error("[post-process] Failed to create agent log:", err);
      });
    } catch (err) {
      console.error("[post-process] Error in afterAgent:", err);

      // Log error gracefully
      await createAgentLog({
        skill: "post_process",
        trigger: "afterAgent",
        output_summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - startTime,
      }).catch(() => {});

      // Still mark thread as processed to avoid retry loops
      if (threadId) {
        await this.markThreadProcessed(threadId).catch(() => {});
      }
    }

    return state;
  }

  // ── Private: LLM extraction call ────────────────────────────

  private async callExtractionLLM(
    transcript: string,
    settings: Settings,
  ): Promise<ExtractionResult | null> {
    const model = getChatModel(settings.memory_extraction_model);

    // Use structured output with the Zod schema
    const structuredModel = model.withStructuredOutput(ExtractionResultSchema, {
      name: "extraction_result",
    });

    const result = await structuredModel.invoke([
      {
        role: "system" as const,
        content: EXTRACTION_PROMPT,
      },
      {
        role: "user" as const,
        content: transcript,
      },
    ]);

    // Validate the result shape
    const parsed = ExtractionResultSchema.safeParse(result);
    if (!parsed.success) {
      console.error("[post-process] LLM output failed validation:", parsed.error);
      return null;
    }

    return parsed.data;
  }

  // ── Private: Memory semantic dedup ──────────────────────────

  /**
   * For each extracted memory:
   * 1. Embed the memory text
   * 2. Search existing items (agent knowledge) by cosine similarity
   * 3. If similarity > reinforce_threshold (0.95): reinforce (bump last_reinforced_at)
   * 4. If similarity in [update_threshold, reinforce_threshold) (0.85-0.95): update content
   * 5. If similarity < update_threshold (0.85): insert new item
   */
  private async processMemories(
    memories: ExtractedMemory[],
    settings: Settings,
  ): Promise<{ itemIds: string[]; entityIds: string[] }> {
    const itemIds: string[] = [];
    const entityIds: string[] = [];
    const reinforceThreshold = settings.memory_reinforce_threshold;
    const updateThreshold = settings.memory_update_threshold;

    for (const memory of memories) {
      try {
        // 1. Embed the memory
        const vector = await embed(memory.content);

        // 2. Search for similar existing memories
        const similar: SearchResult[] = await searchItems(vector, {
          threshold: updateThreshold,
          limit: 3,
          agentKnowledgeOnly: true,
        });

        if (similar.length > 0 && similar[0].similarity >= reinforceThreshold) {
          // 3a. Reinforce — near-exact match, just bump timestamp
          await updateItem(similar[0].id, {
            last_reinforced_at: new Date().toISOString(),
          });
          itemIds.push(similar[0].id);
        } else if (similar.length > 0 && similar[0].similarity >= updateThreshold) {
          // 3b. Update — similar but not exact, supersede the old item
          const newItem = await createItem({
            type: memory.type,
            content: memory.content,
            source: "posthook",
            confirmed: true,
            embedding: vector,
            embedding_model: settings.embedding_model,
          });
          // Mark old item as superseded
          await updateItem(similar[0].id, {
            superseded_by: newItem.id,
            status: "archived",
          });
          itemIds.push(newItem.id);
        } else {
          // 3c. Insert — no close match, create new memory
          const newItem = await createItem({
            type: memory.type,
            content: memory.content,
            source: "posthook",
            confirmed: true,
            embedding: vector,
            embedding_model: settings.embedding_model,
          } as CreateItemInput);
          itemIds.push(newItem.id);
        }
      } catch (err) {
        console.error(`[post-process] Failed to process memory "${memory.content}":`, err);
      }
    }

    return { itemIds, entityIds };
  }

  // ── Private: Entity semantic dedup ──────────────────────────

  /**
   * For each extracted entity:
   * 1. Embed the entity name + description
   * 2. Search existing entities by cosine similarity
   * 3. If similarity > exact_threshold (0.95): exact merge (bump mention_count, merge aliases)
   * 4. If similarity in [fuzzy_threshold, exact_threshold) (0.80-0.95): fuzzy merge or inbox
   * 5. If similarity < fuzzy_threshold (0.80): create new entity
   */
  private async processEntities(
    entities: ExtractedEntity[],
    settings: Settings,
  ): Promise<string[]> {
    const entityIds: string[] = [];
    const exactThreshold = settings.entity_exact_threshold;
    const fuzzyThreshold = settings.entity_fuzzy_threshold;

    for (const entity of entities) {
      try {
        // 1. Build embedding text: name + description for richer embedding
        const embedText = entity.description
          ? `${entity.name}: ${entity.description}`
          : entity.name;
        const vector = await embed(embedText);

        // 2. Search for similar existing entities
        const similar: EntitySearchResult[] = await searchEntities(vector, {
          threshold: fuzzyThreshold,
          limit: 3,
        });

        if (similar.length > 0 && similar[0].similarity >= exactThreshold) {
          // 3a. Exact merge — same entity, merge aliases and bump mention count
          const existing = similar[0];
          const mergedAliases = mergeAliases(
            existing.aliases,
            entity.aliases ?? [],
            entity.name,
          );

          await updateEntity(existing.id, {
            aliases: mergedAliases,
            mention_count: existing.mention_count + 1,
            last_seen_at: new Date().toISOString(),
            description: entity.description ?? existing.description,
          });
          entityIds.push(existing.id);
        } else if (similar.length > 0 && similar[0].similarity >= fuzzyThreshold) {
          // 3b. Fuzzy match — may be the same entity, depends on approval mode
          const existing = similar[0];

          if (settings.approval_merge_entity === "auto") {
            // Auto-merge: merge aliases and bump mention count
            const mergedAliases = mergeAliases(
              existing.aliases,
              entity.aliases ?? [],
              entity.name,
            );
            await updateEntity(existing.id, {
              aliases: mergedAliases,
              mention_count: existing.mention_count + 1,
              last_seen_at: new Date().toISOString(),
              description: entity.description ?? existing.description,
            });
            entityIds.push(existing.id);
          } else {
            // Confirm mode: create unconfirmed entity with pending_action
            const newEntity = await upsertEntity({
              name: entity.name,
              type: entity.type as EntityType,
              aliases: entity.aliases ?? [],
              description: entity.description,
              embedding: vector,
            });
            await updateEntity(newEntity.id, {
              confirmed: false,
              pending_action: `Possible duplicate of "${existing.name}" (${(similar[0].similarity * 100).toFixed(0)}% similar). Approve to keep as separate, or merge.`,
            });
            entityIds.push(newEntity.id);
          }
        } else {
          // 3c. New entity — no close match
          const newEntity = await upsertEntity({
            name: entity.name,
            type: entity.type as EntityType,
            aliases: entity.aliases ?? [],
            description: entity.description,
            embedding: vector,
          });
          entityIds.push(newEntity.id);
        }
      } catch (err) {
        console.error(`[post-process] Failed to process entity "${entity.name}":`, err);
      }
    }

    return entityIds;
  }

  // ── Private: Entity-item linking ──────────────────────────────

  /**
   * Link all extracted entities to all items created during the conversation.
   */
  private async linkEntitiesToItems(entityIds: string[], itemIds: string[]): Promise<void> {
    if (entityIds.length === 0 || itemIds.length === 0) return;

    for (const entityId of entityIds) {
      for (const itemId of itemIds) {
        try {
          await linkItemEntity(itemId, entityId, "mentioned");
        } catch (err) {
          // Swallow — link may already exist or item/entity may have been deleted
          console.error(
            `[post-process] Failed to link entity ${entityId} to item ${itemId}:`,
            err,
          );
        }
      }
    }
  }

  // ── Private: Mark thread as processed ─────────────────────────

  private async markThreadProcessed(threadId: string): Promise<void> {
    await setThreadMetadata(threadId, {
      processed_by_hook: true,
      processed_at: new Date().toISOString(),
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Merge alias arrays, deduplicating and optionally adding the new entity name
 * as an alias of the existing entity.
 */
function mergeAliases(
  existingAliases: string[],
  newAliases: string[],
  newEntityName: string,
): string[] {
  const all = new Set(existingAliases.map((a) => a.toLowerCase()));
  const result = [...existingAliases];

  // Add the new entity's name as an alias if it's not already present
  if (!all.has(newEntityName.toLowerCase())) {
    result.push(newEntityName);
    all.add(newEntityName.toLowerCase());
  }

  // Add any new aliases that aren't already present
  for (const alias of newAliases) {
    if (!all.has(alias.toLowerCase())) {
      result.push(alias);
      all.add(alias.toLowerCase());
    }
  }

  return result;
}
