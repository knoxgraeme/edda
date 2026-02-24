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
  getSettingsSync,
} from "@edda/db";
import type { Settings, SearchResult, EntitySearchResult } from "@edda/db";
import { embedBatch, buildEmbeddingText } from "../../embed/index.js";
import { getChatModel } from "../../llm/index.js";
import { maybeRefreshAgentsMd } from "../generate-agents-md.js";
import { maybeHotpatchMemoryFiles } from "../memory-triage.js";
import { getMessageText, getMessageRole, buildTranscript } from "../message-helpers.js";
import type { MessageLike } from "../message-helpers.js";

// ── Zod schemas for structured LLM output ──────────────────────

const MemorySchema = z.object({
  type: z.enum(["preference", "learned_fact", "pattern"]),
  content: z.string().describe("The memory to store, written as a concise statement"),
  confidence: z.enum(["high", "medium", "low"]).describe(
    "How confident: high = explicitly stated or clearly implied, medium = reasonably inferred, low = loosely inferred or ambiguous"
  ),
});

const ExtractedEntitySchema = z.object({
  name: z.string().describe("Canonical name (e.g. 'Sarah Chen', not 'Sarah')"),
  type: z.enum(["person", "project", "company", "topic", "place", "tool", "concept"]),
  description: z.string().optional().describe("One-line description if inferrable"),
  aliases: z.array(z.string()).optional().describe("Alternative names used in conversation"),
});

const EntityLinkSchema = z.object({
  entity_name: z.string().describe("The entity name this link is for"),
  relationship: z.enum(["mentioned", "about", "assigned_to", "decided_by"]).describe("How the entity relates to the conversation items"),
});

const ExtractionResultSchema = z.object({
  memories: z.array(MemorySchema).describe("Implicit knowledge extracted from the conversation"),
  entities: z
    .array(ExtractedEntitySchema)
    .describe("Named entities mentioned in the conversation"),
  entity_links: z.array(EntityLinkSchema).optional()
    .describe("Relationship types for extracted entities. If omitted, defaults to 'mentioned' for all."),
});

type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
type ExtractedMemory = z.infer<typeof MemorySchema>;
type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

const VALID_ENTITY_TYPES = new Set<string>(
  ExtractedEntitySchema.shape.type.options,
);

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

For each memory, also rate your confidence:
- **high**: The user explicitly stated this or it's clearly implied (e.g., "I work at Acme Corp")
- **medium**: Reasonably inferred from context (e.g., user discusses React a lot → "frequently works with React")
- **low**: Loosely inferred or ambiguous (e.g., user mentioned hiking once → "may enjoy hiking")

## 2. Entities
Extract named entities: people, projects, companies, topics, places, tools, or concepts.
Use the canonical/full form of the name (e.g. "Sarah Chen" not just "Sarah").
Include aliases if the conversation used shorthand (e.g. aliases: ["k8s"] for "Kubernetes").

## 3. Entity Relationships
For each entity, specify the relationship to items in this conversation:
- **mentioned**: Entity was referenced in passing
- **about**: An item is primarily about this entity
- **assigned_to**: An item (task, action) was assigned to this entity
- **decided_by**: A decision item was made by this entity

## Rules
- Be conservative. Only extract things with high confidence.
- Do not fabricate or infer beyond what the conversation clearly implies.
- If the conversation has no extractable knowledge, return empty arrays.
- Write memories as concise, third-person statements about the user.

## Conversation Transcript
`;

// ── Message type for the state we receive ───────────────────────

interface ConversationState {
  messages?: MessageLike[];
  configurable?: {
    thread_id?: string;
  };
}

// ── Helper: extract created item IDs from tool call results ─────

/**
 * Scans the message history for tool call results that contain item IDs
 * (from create_item, batch_create_items, update_item tool calls).
 */
function isConversationState(value: unknown): value is ConversationState {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.messages !== undefined && !Array.isArray(obj.messages)) return false;
  return true;
}

const ITEM_CREATION_TOOLS = new Set(["create_item", "batch_create_items", "update_item"]);

function extractCreatedItemIds(messages: MessageLike[]): string[] {
  const ids: string[] = [];
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  for (const msg of messages) {
    const role = getMessageRole(msg);
    // Tool results come back as "tool" type messages
    if (role !== "tool") continue;

    // Only process results from item-creation tools
    if (!msg.name || !ITEM_CREATION_TOOLS.has(msg.name)) continue;

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
    // Validate state shape at runtime instead of blind cast
    if (!isConversationState(state)) {
      return state;
    }

    const messages = state.messages;
    const threadId = state.configurable?.thread_id;

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
      await this.processMemories(extraction.memories, settings);

      // 5. Process entities with semantic dedup
      const { entityIds: allEntityIds, entityNameToId } =
        await this.processEntities(extraction.entities, settings);

      // 6. Link entities to items created during the conversation
      await this.linkEntitiesToItems(
        allEntityIds,
        createdItemIds,
        extraction.entity_links,
        entityNameToId,
      );

      // 7. Mark thread as processed
      if (threadId) {
        await this.markThreadProcessed(threadId);
      }

      // 8. Regenerate AGENTS.md
      await maybeRefreshAgentsMd().catch((err: unknown) => {
        console.error("[post-process] Failed to refresh AGENTS.md:", err);
      });

      // 8b. Hotpatch memory files if conversation contradicts or adds significant info
      // Fire-and-forget: do not block post-process completion
      maybeHotpatchMemoryFiles(messages, extraction.entities).catch((err: unknown) => {
        console.error("[post-process] Failed to hotpatch memory files:", err);
      });

    } catch (err) {
      console.error("[post-process] Error in afterAgent:", err);

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
    const model = await getChatModel(settings.memory_extraction_model);

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

    // withStructuredOutput validates against ExtractionResultSchema at runtime
    return (result as ExtractionResult) ?? null;
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
  ): Promise<{ itemIds: string[] }> {
    const itemIds: string[] = [];
    const reinforceThreshold = settings.memory_reinforce_threshold;
    const updateThreshold = settings.memory_update_threshold;

    // Batch-embed all memory texts
    const texts = memories.map((m) => buildEmbeddingText(m.type, m.content));
    const vectors = texts.length > 0 ? await embedBatch(texts) : [];

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const vector = vectors[i];
      try {
        // Search for similar existing memories
        const similar: SearchResult[] = await searchItems(vector, {
          threshold: updateThreshold,
          limit: 3,
          agentKnowledgeOnly: true,
          confirmedOnly: false,
        });

        if (similar.length > 0 && similar[0].raw_similarity >= reinforceThreshold) {
          // Reinforce — near-exact match, just bump timestamp
          await updateItem(similar[0].id, {
            last_reinforced_at: new Date().toISOString(),
          });
          itemIds.push(similar[0].id);
        } else if (similar.length > 0 && similar[0].raw_similarity >= updateThreshold) {
          // Update — similar but not exact, supersede the old item
          const isConfirmed = memory.confidence === 'high';
          const newItem = await createItem({
            type: memory.type,
            content: memory.content,
            source: "posthook",
            confirmed: isConfirmed,
            pending_action: isConfirmed ? undefined : `Auto-extracted with ${memory.confidence} confidence. Review and confirm or reject.`,
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
          // Insert — no close match, create new memory
          const isConfirmed = memory.confidence === 'high';
          const newItem = await createItem({
            type: memory.type,
            content: memory.content,
            source: "posthook",
            confirmed: isConfirmed,
            pending_action: isConfirmed ? undefined : `Auto-extracted with ${memory.confidence} confidence. Review and confirm or reject.`,
            embedding: vector,
            embedding_model: settings.embedding_model,
          });
          itemIds.push(newItem.id);
        }
      } catch (err) {
        console.error(`[post-process] Failed to process memory "${memory.content}":`, err);
      }
    }

    return { itemIds };
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
  ): Promise<{ entityIds: string[]; entityNameToId: Map<string, string> }> {
    const entityIds: string[] = [];
    const entityNameToId = new Map<string, string>();
    const exactThreshold = settings.entity_exact_threshold;
    const fuzzyThreshold = settings.entity_fuzzy_threshold;

    // Filter to entities with valid types
    const validEntities = entities.filter((e) => VALID_ENTITY_TYPES.has(e.type));

    // 1. Batch-embed all entity texts
    const embedTexts = validEntities.map((entity) =>
      entity.description ? `${entity.name}: ${entity.description}` : entity.name,
    );
    const vectors = embedTexts.length > 0 ? await embedBatch(embedTexts) : [];

    for (let i = 0; i < validEntities.length; i++) {
      const entity = validEntities[i];
      const vector = vectors[i];
      try {
        // 2. Search for similar existing entities
        const similar: EntitySearchResult[] = await searchEntities(vector, {
          threshold: fuzzyThreshold,
          limit: 3,
        });

        if (similar.length > 0 && similar[0].raw_similarity >= exactThreshold) {
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
          entityNameToId.set(entity.name.toLowerCase(), existing.id);
        } else if (similar.length > 0 && similar[0].raw_similarity >= fuzzyThreshold) {
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
            entityNameToId.set(entity.name.toLowerCase(), existing.id);
          } else {
            // Confirm mode: create unconfirmed entity with pending_action
            const newEntity = await upsertEntity({
              name: entity.name,
              type: entity.type,
              aliases: entity.aliases ?? [],
              description: entity.description,
              embedding: vector,
            });
            await updateEntity(newEntity.id, {
              confirmed: false,
              pending_action: `Possible duplicate of "${existing.name}" (${(similar[0].raw_similarity * 100).toFixed(0)}% similar). Approve to keep as separate, or merge.`,
            });
            entityIds.push(newEntity.id);
            entityNameToId.set(entity.name.toLowerCase(), newEntity.id);
          }
        } else {
          // 3c. New entity — no close match
          const newEntity = await upsertEntity({
            name: entity.name,
            type: entity.type,
            aliases: entity.aliases ?? [],
            description: entity.description,
            embedding: vector,
          });
          entityIds.push(newEntity.id);
          entityNameToId.set(entity.name.toLowerCase(), newEntity.id);
        }
      } catch (err) {
        console.error(`[post-process] Failed to process entity "${entity.name}":`, err);
      }
    }

    return { entityIds, entityNameToId };
  }

  // ── Private: Entity-item linking ──────────────────────────────

  /**
   * Link all extracted entities to all items created during the conversation.
   * Uses relationship types from entity_links when available, falls back to "mentioned".
   */
  private async linkEntitiesToItems(
    entityIds: string[],
    itemIds: string[],
    entityLinks?: Array<{ entity_name: string; relationship: string }>,
    entityNameToId?: Map<string, string>,
  ): Promise<void> {
    if (entityIds.length === 0 || itemIds.length === 0) return;

    // Build a reverse map: entityId -> relationship
    const idToRelationship = new Map<string, string>();
    if (entityLinks && entityNameToId) {
      for (const link of entityLinks) {
        const entityId = entityNameToId.get(link.entity_name.toLowerCase());
        if (entityId) {
          idToRelationship.set(entityId, link.relationship);
        }
      }
    }

    for (const entityId of entityIds) {
      const relationship = idToRelationship.get(entityId) ?? "mentioned";
      for (const itemId of itemIds) {
        try {
          await linkItemEntity(itemId, entityId, relationship);
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
