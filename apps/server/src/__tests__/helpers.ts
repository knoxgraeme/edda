/**
 * Test helpers for @edda/server unit tests.
 *
 * Provides mock factories for @edda/db and embed modules.
 */

import { vi } from "vitest";
import type { Settings } from "@edda/db";
import { ITEM_COLS, ENTITY_COLS, LLM_PROVIDERS } from "@edda/db";

/** Default settings fixture matching the Settings interface */
export const DEFAULT_TEST_SETTINGS: Settings = {
  id: true,
  llm_provider: "anthropic",
  default_model: "claude-sonnet-4-6",
  embedding_provider: "voyage",
  embedding_model: "voyage-3",
  embedding_dimensions: 1536,
  search_provider: "duckduckgo",
  web_search_enabled: false,
  web_search_max_results: 5,
  checkpointer_backend: "memory",
  agents_md_token_budget: 1500,
  agents_md_max_per_category: 10,
  agents_md_max_versions: 3,
  agents_md_max_entities: 10,
  cron_runner: "local",
  langgraph_platform_url: null,
  approval_new_type: "confirm",
  approval_archive_stale: "confirm",
  approval_merge_entity: "confirm",
  system_prompt_override: null,
  setup_completed: false,
  user_display_name: null,
  user_timezone: "America/New_York",
  default_agent: "edda",
  approval_new_entity: "auto",
  memory_extraction_model: null,
  sandbox_provider: "none",
  task_max_concurrency: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/**
 * Returns mock fns for all @edda/db exports.
 * Use with `vi.mock("@edda/db", () => mockDbModule())` at top of test file.
 */
export function mockDbModule() {
  return {
    // items.ts
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    getItemById: vi.fn(),
    searchItems: vi.fn(),
    batchCreateItems: vi.fn(),
    getTimeline: vi.fn(),
    getAgentKnowledge: vi.fn(),
    getItemsByType: vi.fn(),
    ITEM_COLS,

    // lists.ts
    createList: vi.fn(),
    getListById: vi.fn(),
    getListByName: vi.fn(),
    getAllLists: vi.fn().mockResolvedValue([]),
    getListItems: vi.fn(),
    updateList: vi.fn(),
    searchLists: vi.fn().mockResolvedValue([]),
    LIST_COLS: `id, name, normalized_name, summary, icon, list_type,
  status, embedding_model, metadata, created_at, updated_at`,

    // entities.ts
    upsertEntity: vi.fn(),
    updateEntity: vi.fn(),
    getEntityById: vi.fn(),
    getEntitiesByName: vi.fn(),
    searchEntities: vi.fn(),
    resolveEntity: vi.fn(),
    getEntityItems: vi.fn(),
    linkItemEntity: vi.fn(),
    getTopEntities: vi.fn(),
    ENTITY_COLS,

    // settings.ts
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getSettingsSync: vi.fn().mockReturnValue(DEFAULT_TEST_SETTINGS),
    refreshSettings: vi.fn(),

    // item-types.ts
    getItemTypes: vi.fn().mockResolvedValue([]),
    getItemTypeByName: vi.fn().mockResolvedValue(null),
    createItemType: vi.fn(),
    deleteItemType: vi.fn(),
    updateItemType: vi.fn(),

    // dashboard.ts
    getDashboard: vi.fn(),
    getPendingConfirmationsCount: vi.fn().mockResolvedValue(0),

    // mcp-connections.ts
    getMcpConnections: vi.fn().mockResolvedValue([]),
    createMcpConnection: vi.fn(),
    updateMcpConnection: vi.fn(),
    deleteMcpConnection: vi.fn(),

    // confirmations.ts
    confirmPending: vi.fn(),
    rejectPending: vi.fn(),

    // agents-md.ts
    getLatestAgentsMd: vi.fn().mockResolvedValue(null),
    saveAgentsMdVersion: vi.fn(),
    pruneAgentsMdVersions: vi.fn(),
    getAgentsMdContent: vi.fn().mockResolvedValue(""),

    // items.ts (additional)
    countSessionNotesSince: vi.fn().mockResolvedValue(0),

    // notifications.ts
    createNotification: vi.fn(),

    // threads.ts
    upsertThread: vi.fn(),
    setThreadMetadata: vi.fn(),
    getUnprocessedThreads: vi.fn().mockResolvedValue([]),

    // migrate.ts / seed-settings.ts
    runMigrations: vi.fn(),
    seedSettings: vi.fn(),

    // connection
    getPool: vi.fn(),
    closePool: vi.fn(),

    // constants
    LLM_PROVIDERS,
  };
}

const ZERO_VECTOR: readonly number[] = Object.freeze(new Array(1536).fill(0));

/** Returns mock fns for the embed module. */
export function mockEmbedModule() {
  return {
    embed: vi.fn().mockResolvedValue(ZERO_VECTOR),
    embedBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => ZERO_VECTOR)),
    ),
    getEmbeddings: vi.fn().mockResolvedValue([]),
  };
}
