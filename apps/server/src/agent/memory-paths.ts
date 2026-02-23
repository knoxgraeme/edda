/**
 * Shared memory file path utilities — used by generate-agents-md, memory-triage,
 * and create-memory-file tool.
 */

import type { EntityType } from "@edda/db";

/** Map entity type → memory file directory name */
export const ENTITY_TYPE_TO_DIR: Partial<Record<EntityType, string>> = {
  person: "people",
  project: "projects",
  company: "organizations",
};

/** Valid memory directory names for path validation */
export const VALID_MEMORY_DIRS = new Set(Object.values(ENTITY_TYPE_TO_DIR));

/** Convert entity name to a memory file key, e.g. "Sarah Chen" → "/people/sarah-chen" */
export function entityToMemoryKey(name: string, type: EntityType): string | null {
  const dir = ENTITY_TYPE_TO_DIR[type];
  if (!dir) return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/${dir}/${slug}`;
}

/** Regex pattern for valid memory file paths: /<type>/<slug> */
export const MEMORY_PATH_REGEX = /^\/(?:people|projects|organizations)\/[a-z0-9][a-z0-9-]{0,100}$/;

/**
 * Value shape for memory files in PostgresStore.
 * All store.put() calls for memory files MUST use this shape.
 */
export interface MemoryFileRecord {
  content: string[];
  created_at: string;
  modified_at: string;
  memory_type: string;
  entity_id?: string;
  source: "cron" | "hotpatch";
  summary?: string;
  [key: string]: unknown;
}
