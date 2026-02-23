/**
 * @edda/db — Shared type definitions
 *
 * These types are the single source of truth for the Edda data model.
 * Used by: server (agent backend), web (frontend), cli (setup wizard).
 */

// ──────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────

export type LlmProvider = "anthropic" | "openai" | "google" | "groq" | "ollama" | "mistral" | "bedrock";
export type EmbeddingProvider = "voyage" | "openai" | "google";
export type SearchProvider = "tavily" | "brave" | "serper" | "serpapi";
export type CheckpointerBackend = "postgres" | "sqlite" | "memory";
export type CronRunner = "standalone" | "platform";
export type ApprovalMode = "auto" | "confirm";

export interface Settings {
  id: true;

  // LLM
  llm_provider: LlmProvider;
  default_model: string;

  // Embeddings
  embedding_provider: EmbeddingProvider;
  embedding_model: string;
  embedding_dimensions: number;

  // Search
  search_provider: SearchProvider;
  web_search_enabled: boolean;
  web_search_max_results: number;

  // Checkpointer
  checkpointer_backend: CheckpointerBackend;

  // Memory extraction
  memory_extraction_enabled: boolean;
  memory_extraction_cron: string;
  memory_extraction_model: string;

  // Memory dedup thresholds
  memory_reinforce_threshold: number;
  memory_update_threshold: number;
  entity_exact_threshold: number;
  entity_fuzzy_threshold: number;

  // AGENTS.md budget
  agents_md_token_budget: number;
  agents_md_max_per_category: number;
  agents_md_max_versions: number;
  agents_md_max_entities: number;

  // Tool call limits
  tool_call_limit_global: number;
  tool_call_limit_delete: number;
  tool_call_limit_archive: number;

  // System cron schedules
  daily_digest_cron: string;
  daily_digest_model: string;
  weekly_review_cron: string;
  weekly_review_model: string;
  type_evolution_cron: string;
  type_evolution_model: string;

  // User crons
  user_crons_enabled: boolean;
  user_cron_check_interval: string;
  user_cron_model: string;
  cron_runner: CronRunner;
  langgraph_platform_url: string | null;

  // Approvals
  approval_new_type: ApprovalMode;
  approval_archive_stale: ApprovalMode;
  approval_merge_entity: ApprovalMode;

  // Personality
  system_prompt_override: string | null;

  // Setup
  setup_completed: boolean;
  user_display_name: string | null;
  user_timezone: string;

  // Context refresh
  context_refresh_cron: string;
  context_refresh_model: string;

  // Memory sync
  memory_sync_cron: string;
  memory_sync_model: string;
  memory_file_activity_threshold: number;
  memory_file_stale_days: number;

  // Meta
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────
// AGENTS.md Versions
// ──────────────────────────────────────────────

export interface AgentsMdVersion {
  id: number;
  content: string;
  template: string;
  input_hash: string | null;
  created_at: string;
}

// ──────────────────────────────────────────────
// Items
// ──────────────────────────────────────────────

export type ItemStatus = "active" | "done" | "archived" | "snoozed";
export type ItemSource = "chat" | "cli" | "api" | "cron" | "agent" | "posthook";

export interface Item {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  status: ItemStatus;
  source: ItemSource;
  day: string; // YYYY-MM-DD
  confirmed: boolean;
  parent_id: string | null;
  embedding: number[] | null;
  embedding_model: string | null;
  superseded_by: string | null;
  completed_at: string | null;
  pending_action: string | null;
  last_reinforced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateItemInput {
  type: string;
  content: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  status?: ItemStatus;
  source?: ItemSource;
  day?: string;
  confirmed?: boolean;
  parent_id?: string;
  embedding?: number[];
  embedding_model?: string;
  pending_action?: string;
}

// ──────────────────────────────────────────────
// Entities
// ──────────────────────────────────────────────

export type EntityType = "person" | "project" | "company" | "topic" | "place" | "tool" | "concept";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  description: string | null;
  mention_count: number;
  last_seen_at: string;
  embedding: number[] | null;
  confirmed: boolean;
  pending_action: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────
// Item Types (dynamic)
// ──────────────────────────────────────────────

export interface ItemType {
  name: string;
  icon: string;
  description: string;
  metadata_schema: Record<string, unknown>;
  classification_hint: string;
  extraction_hint: string;
  dashboard_section: string;
  dashboard_priority: number;
  completable: boolean;
  has_due_date: boolean;
  is_list: boolean;
  include_in_recall: boolean;
  private: boolean;
  agent_internal: boolean;
  built_in: boolean;
  is_user_created: boolean;
  created_by: string;
  confirmed: boolean;
  pending_action: string | null;
  created_at: string;
}

// ──────────────────────────────────────────────
// MCP Connections
// ──────────────────────────────────────────────

export interface McpConnection {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "streamable-http";
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

// ──────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────

export interface DashboardData {
  due_today: Item[];
  captured_today: Item[];
  open_items: Item[];
  lists: Record<string, Item[]>;
  pending_confirmations: Item[];
}

// ──────────────────────────────────────────────
// Agent Log
// ──────────────────────────────────────────────

export interface AgentLog {
  id: string;
  skill: string;
  trigger: string;
  input_summary: string | null;
  output_summary: string | null;
  items_created: string[];
  items_retrieved: string[];
  entities_created: string[];
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface CreateAgentLogInput {
  skill: string;
  trigger: string;
  input_summary?: string;
  output_summary?: string;
  items_created?: string[];
  items_retrieved?: string[];
  entities_created?: string[];
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  duration_ms?: number;
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────

export interface SearchResult extends Item {
  similarity: number;
}

export interface EntitySearchResult extends Entity {
  similarity: number;
}

// ──────────────────────────────────────────────
// Pending Items (inbox)
// ──────────────────────────────────────────────

export interface PendingItem {
  id: string;
  table: "items" | "entities" | "item_types";
  type: string;
  label: string;
  description: string | null;
  pendingAction: string | null;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Skills
// ──────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  version: number;
  is_system: boolean;
  confirmed: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertSkillInput {
  name: string;
  description: string;
  content: string;
  is_system?: boolean;
  created_by?: string;
}

// ──────────────────────────────────────────────
// Memory Types
// ──────────────────────────────────────────────

export interface MemoryType {
  name: string;
  description: string;
  entity_types: EntityType[];
  activity_threshold: number;
  stale_days: number;
  synthesis_style: string;
  split_threshold: number;
  built_in: boolean;
  created_at: string;
}
