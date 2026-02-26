/**
 * @edda/db — Shared type definitions
 *
 * These types are the single source of truth for the Edda data model.
 * Used by: server (agent backend), web (frontend), cli (setup wizard).
 */

// ──────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────

export type LlmProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "ollama"
  | "mistral"
  | "bedrock";
export type EmbeddingProvider = "voyage" | "openai" | "google";
export type SearchProvider = "tavily" | "brave" | "serper" | "serpapi" | "duckduckgo";
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

  // Memory catchup
  memory_catchup_cron: string;
  memory_catchup_model: string;

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

  // Crons
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

  // Agent channels
  task_max_concurrency: number;

  // Default agent
  default_agent: string;

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
  agent_name: string;
  created_at: string;
}

// ──────────────────────────────────────────────
// Lists
// ──────────────────────────────────────────────

export type ListType = 'rolling' | 'one_off';
export type ListStatus = 'active' | 'archived';

export interface List {
  id: string;
  name: string;
  normalized_name: string;
  summary: string | null;
  icon: string;
  list_type: ListType;
  status: ListStatus;
  embedding: number[] | null;
  embedding_model: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateListInput {
  name: string;
  normalized_name?: string;
  summary?: string;
  icon?: string;
  list_type?: ListType;
  embedding?: number[];
  embedding_model?: string;
  metadata?: Record<string, unknown>;
}

export interface ListWithCount extends List {
  item_count: number;
}

export interface ListSearchResult extends List {
  similarity: number;
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
  list_id: string | null;
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
  list_id?: string;
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
  agent_internal: boolean;
  confirmed: boolean;
  pending_action: string | null;
  decay_half_life_days: number | null;
  created_at: string;
}

// ──────────────────────────────────────────────
// MCP Connections
// ──────────────────────────────────────────────

export type McpAuthType = "none" | "bearer" | "oauth";
export type McpAuthStatus = "active" | "pending_auth" | "error";

export interface McpConnection {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "streamable-http";
  config: Record<string, unknown>;
  enabled: boolean;
  discovered_tools: string[];
  auth_type: McpAuthType;
  auth_status: McpAuthStatus;
  created_at: string;
}

export interface McpOAuthStateRow {
  connection_id: string;
  client_info_encrypted: string | null;
  tokens_encrypted: string | null;
  expires_at: string | null;
  discovery_state: Record<string, unknown> | null;
  pending_auth: {
    code_verifier_encrypted: string;
    state_param: string;
    completion_secret: string;
  } | null;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────

export interface DashboardData {
  due_today: Item[];
  captured_today: Item[];
  open_items: Item[];
  lists: Record<string, { list: List; items: Item[] }>;
  pending_confirmations: Item[];
}

// ──────────────────────────────────────────────
// Retrieval Context (search-time affinity)
// ──────────────────────────────────────────────

export interface RetrievalContext {
  /** Agent names to match against metadata->>'created_by' on items.
   *  Defaults to [self] when authorship_mode is set but authors is omitted. */
  authors?: string[];
  /** "boost" = prefer these authors' items. "filter" = only these authors' items. */
  authorship_mode?: "boost" | "filter";
  /** Score multiplier for authorship boost (e.g. 1.3 = 30% boost). Ignored in filter mode. */
  authorship_boost?: number;
  /** Item types to prefer or restrict to. */
  types?: string[];
  /** "boost" = prefer these types. "filter" = only these types. */
  type_mode?: "boost" | "filter";
  /** Score multiplier for type boost (e.g. 1.2 = 20% boost). Ignored in filter mode. */
  type_boost?: number;
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────

export interface SearchResult extends Item {
  similarity: number;
  raw_similarity: number;
}

export interface EntitySearchResult extends Entity {
  similarity: number;
  raw_similarity: number;
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
// Agents
// ──────────────────────────────────────────────

export type ThreadLifetime = "ephemeral" | "daily" | "persistent";
/** @deprecated Use ThreadLifetime instead */
export type AgentContextMode = ThreadLifetime;
export type AgentTrigger = "schedule" | "on_demand";
export type TaskRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TaskRunTrigger = "cron" | "user" | "orchestrator" | "hook" | "agent" | "notification";

export interface Agent {
  id: string;
  name: string;
  description: string;
  system_prompt: string | null;
  skills: string[];
  thread_lifetime: ThreadLifetime;
  trigger: AgentTrigger | null;
  tools: string[];
  subagents: string[];
  model_settings_key: string | null;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskRun {
  id: string;
  agent_id: string | null;
  agent_name: string;
  trigger: TaskRunTrigger;
  status: TaskRunStatus;
  thread_id: string | null;
  schedule_id: string | null;
  input_summary: string | null;
  output_summary: string | null;
  model: string | null;
  tokens_used: number | null;
  duration_ms: number | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ──────────────────────────────────────────────
// Agent Schedules
// ──────────────────────────────────────────────

export interface AgentSchedule {
  id: string;
  agent_id: string;
  name: string;
  cron: string;
  prompt: string;
  thread_lifetime: ThreadLifetime | null;
  notify: string[];
  notify_expires_after: string;
  enabled: boolean;
  created_at: string;
}

// ──────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────

export type NotificationSourceType = "schedule" | "agent" | "system";
export type NotificationTargetType = "inbox" | "agent";
export type NotificationPriority = "low" | "normal" | "high";
export type NotificationStatus = "unread" | "read" | "dismissed";

export interface Notification {
  id: string;
  source_type: NotificationSourceType;
  source_id: string;
  target_type: NotificationTargetType;
  target_id: string | null;
  summary: string;
  detail: Record<string, unknown>;
  priority: NotificationPriority;
  status: NotificationStatus;
  expires_at: string;
  created_at: string;
}
