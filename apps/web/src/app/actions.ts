"use server";

import { timingSafeEqual } from "crypto";
import {
  confirmPending,
  rejectPending,
  updateItem,
  updateEntity,
  getEntityItems,
  updateSettings,
  getSettings,
  getAgentByName,
  dismissNotification,
  createAgent,
  updateAgent,
  deleteAgent,
  createSchedule as createScheduleDb,
  updateSchedule as updateScheduleDb,
  deleteSchedule as deleteScheduleDb,
  createChannel as createChannelDb,
  updateChannel as updateChannelDb,
  deleteChannel as deleteChannelDb,
  type Settings,
  type Entity,
  type Item,
  type ThreadLifetime,
  type AgentTrigger,
  type LlmProvider,
  type ChannelPlatform,
  LLM_PROVIDERS,
} from "@edda/db";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { computeSessionToken, COOKIE_NAME, THIRTY_DAYS } from "@/lib/auth";

const isValidIanaTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

// Mirrors UpdateSettingsSchema from /api/v1/settings/route.ts — keep in sync
const UpdateSettingsSchema = z
  .object({
    user_display_name: z.string().max(200).nullable().optional(),
    user_timezone: z
      .string()
      .max(100)
      .optional()
      .refine((value) => value === undefined || isValidIanaTimezone(value), "Invalid IANA timezone"),
    llm_provider: z
      .enum([...LLM_PROVIDERS])
      .optional(),
    default_model: z.string().max(100).optional(),
    embedding_provider: z.enum(["voyage", "openai", "google"]).optional(),
    embedding_model: z.string().max(100).optional(),
    default_agent: z.string().min(1).max(200).optional(),
  })
  .strip();

const CRON_FIELD_RE = /^(\*|(\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?|\*\/\d+)$/;
function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD_RE.test(f));
}

const VALID_TABLES = new Set([
  "items",
  "entities",
  "item_types",
  "telegram_paired_users",
  "paired_users",
] as const);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(["active", "done", "archived", "snoozed"] as const);
const MAX_BATCH_SIZE = 500;

type ConfirmableTable = "items" | "entities" | "item_types" | "telegram_paired_users" | "paired_users";

function validateTable(table: string): asserts table is ConfirmableTable {
  if (!VALID_TABLES.has(table as ConfirmableTable)) {
    throw new Error("Invalid table");
  }
}

function validateId(id: string, table: string): void {
  if (table === "item_types") {
    if (!id || id.length > 100) throw new Error("Invalid id");
  } else {
    if (!UUID_RE.test(id)) throw new Error("Invalid id");
  }
}

export async function confirmPendingAction(
  table: ConfirmableTable,
  id: string,
) {
  validateTable(table);
  validateId(id, table);
  try {
    await confirmPending(table, id);
  } catch (err: unknown) {
    console.error("Failed to confirm pending item:", err);
    throw new Error("Failed to confirm item. Please try again.");
  }
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

export async function rejectPendingAction(
  table: ConfirmableTable,
  id: string,
) {
  validateTable(table);
  validateId(id, table);
  await rejectPending(table, id);
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

export async function confirmAllPendingAction(
  items: Array<{ table: ConfirmableTable; id: string }>,
) {
  if (!Array.isArray(items) || items.length > MAX_BATCH_SIZE) {
    throw new Error("Invalid batch size");
  }
  for (const { table, id } of items) {
    validateTable(table);
    validateId(id, table);
  }
  await Promise.all(items.map(({ table, id }) => confirmPending(table, id)));
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

export async function updateItemStatusAction(
  id: string,
  status: "active" | "done" | "archived" | "snoozed",
) {
  if (!UUID_RE.test(id)) throw new Error("Invalid id");
  if (!VALID_STATUSES.has(status)) throw new Error("Invalid status");

  const updates: Partial<Pick<Parameters<typeof updateItem>[1], "status" | "completed_at">> & {
    status: typeof status;
  } = { status };
  if (status === "done") {
    updates.completed_at = new Date().toISOString();
  }
  try {
    await updateItem(id, updates);
  } catch (err: unknown) {
    console.error("Failed to update item status:", err);
    throw new Error("Failed to update item status. Please try again.");
  }
  revalidatePath("/dashboard");
}

export async function saveSettingsAction(updates: Partial<Settings>) {
  try {
    const validated = UpdateSettingsSchema.parse(updates);
    const saved = await updateSettings(validated);
    revalidatePath("/settings");
    return saved;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to save settings:", message, err);
    // Always throw a plain Error — library errors (Zod, pg) may have
    // non-writable `message` properties that break Next.js serialization.
    const plain = new Error(`Failed to save settings: ${message}`);
    plain.stack = undefined;
    throw plain;
  }
}

export async function updateEntityAction(
  id: string,
  updates: Partial<Pick<Entity, "name" | "description">>,
): Promise<Entity | null> {
  if (!UUID_RE.test(id)) throw new Error("Invalid id");
  const result = await updateEntity(id, updates);
  revalidatePath("/entities");
  return result;
}

export async function getEntityItemsAction(entityId: string): Promise<Item[]> {
  if (!UUID_RE.test(entityId)) throw new Error("Invalid id");
  return getEntityItems(entityId);
}

// ─── Agents ─────────────────────────────────────────────────────────

const AGENT_NAME_RE = /^[a-z][a-z0-9_]*$/;
const AGENT_NAME_MAX_LEN = 100;

const VALID_THREAD_LIFETIMES = new Set<ThreadLifetime>(["ephemeral", "daily", "persistent"]);

const VALID_LLM_PROVIDERS = new Set<LlmProvider>(LLM_PROVIDERS);
const VALID_TRIGGERS = new Set<AgentTrigger>(["schedule", "on_demand"]);

// Default agent cannot be deleted — checked dynamically via settings

const MAX_DESCRIPTION_LEN = 1000;
const MAX_SYSTEM_PROMPT_LEN = 50_000;
const MAX_SKILL_LEN = 100;
const MAX_TOOL_LEN = 100;

function validateAgentName(name: string): void {
  if (!name || name.length > AGENT_NAME_MAX_LEN || !AGENT_NAME_RE.test(name)) {
    throw new Error(
      "Agent name must be lowercase alphanumeric with underscores (max 100 chars)",
    );
  }
}

function validateAgentUpdates(updates: Record<string, unknown>): void {
  if (
    updates.description != null &&
    (typeof updates.description !== "string" || updates.description.length > MAX_DESCRIPTION_LEN)
  ) {
    throw new Error(`Description must be a string (max ${MAX_DESCRIPTION_LEN} chars)`);
  }
  if (updates.system_prompt != null && updates.system_prompt !== null) {
    if (
      typeof updates.system_prompt !== "string" ||
      updates.system_prompt.length > MAX_SYSTEM_PROMPT_LEN
    ) {
      throw new Error(`System prompt must be a string (max ${MAX_SYSTEM_PROMPT_LEN} chars)`);
    }
  }
  if (updates.thread_lifetime != null && !VALID_THREAD_LIFETIMES.has(updates.thread_lifetime as ThreadLifetime)) {
    throw new Error("Invalid thread_lifetime");
  }
  if (updates.trigger != null && updates.trigger !== null && !VALID_TRIGGERS.has(updates.trigger as AgentTrigger)) {
    throw new Error("Invalid trigger");
  }
  if (updates.skills != null) {
    if (!Array.isArray(updates.skills) || updates.skills.some((s: unknown) => typeof s !== "string" || (s as string).length > MAX_SKILL_LEN)) {
      throw new Error("Skills must be an array of strings");
    }
  }
  if (updates.tools != null) {
    if (!Array.isArray(updates.tools) || updates.tools.some((t: unknown) => typeof t !== "string" || (t as string).length > MAX_TOOL_LEN)) {
      throw new Error("Tools must be an array of strings");
    }
  }
  // model_provider and model are independently nullable by design — setting one
  // without the other is allowed (the server falls back to global defaults).
  if (updates.model_provider !== undefined && updates.model_provider !== null) {
    if (typeof updates.model_provider !== "string" || !VALID_LLM_PROVIDERS.has(updates.model_provider as LlmProvider)) {
      throw new Error("Invalid model_provider");
    }
  }
  if (updates.model !== undefined && updates.model !== null) {
    if (typeof updates.model !== "string" || updates.model.length > 100) {
      throw new Error("Model must be a string (max 100 chars)");
    }
  }
  if (updates.enabled != null && typeof updates.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
}

export async function createAgentAction(data: {
  name: string;
  description: string;
  system_prompt?: string;
  skills?: string[];
  thread_lifetime?: ThreadLifetime;
  trigger?: AgentTrigger;
  tools?: string[];
  subagents?: string[];
  model_provider?: string | null;
  model?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Optional initial schedule, created immediately after the agent.
   * Use when trigger = "schedule" so new agents don't land in the
   * broken "scheduled trigger with zero schedules" state.
   */
  schedule?: {
    name: string;
    cron: string;
    prompt: string;
    notify?: string[];
  };
}) {
  validateAgentName(data.name);

  if (!data.description || data.description.length > MAX_DESCRIPTION_LEN) {
    throw new Error(`Description is required (max ${MAX_DESCRIPTION_LEN} chars)`);
  }
  if (data.system_prompt && data.system_prompt.length > MAX_SYSTEM_PROMPT_LEN) {
    throw new Error(`System prompt too long (max ${MAX_SYSTEM_PROMPT_LEN} chars)`);
  }

  const threadLifetime = data.thread_lifetime ?? "ephemeral";
  if (!VALID_THREAD_LIFETIMES.has(threadLifetime)) {
    throw new Error("Invalid thread_lifetime");
  }
  if (data.trigger && !VALID_TRIGGERS.has(data.trigger)) {
    throw new Error("Invalid trigger");
  }
  if (data.model_provider != null && !VALID_LLM_PROVIDERS.has(data.model_provider as LlmProvider)) {
    throw new Error("Invalid model_provider");
  }
  if (data.model != null && (typeof data.model !== "string" || data.model.length > 100)) {
    throw new Error("Model must be a string (max 100 chars)");
  }

  // Validate the optional schedule up-front so we don't create an agent
  // with no schedule when the schedule payload is bad.
  if (data.schedule) {
    const s = data.schedule;
    if (!s.name || s.name.length > 100) {
      throw new Error("Schedule name is required (max 100 chars)");
    }
    if (!s.cron || !isValidCron(s.cron)) {
      throw new Error(
        "Invalid cron expression — expected 5 fields: minute hour day month weekday",
      );
    }
    if (!s.prompt || s.prompt.length > 5000) {
      throw new Error("Schedule prompt is required (max 5000 chars)");
    }
    if (s.notify) validateNotifyTargets(s.notify);
  }

  try {
    const agent = await createAgent({
      name: data.name,
      description: data.description,
      system_prompt: data.system_prompt,
      skills: data.skills ?? [],
      thread_lifetime: threadLifetime,
      trigger: data.trigger,
      tools: data.tools ?? [],
      subagents: data.subagents ?? [],
      model_provider: data.model_provider || null,
      model: data.model || null,
      metadata: data.metadata,
    });
    if (data.schedule) {
      await createScheduleDb({
        agent_id: agent.id,
        name: data.schedule.name,
        cron: data.schedule.cron,
        prompt: data.schedule.prompt,
        notify: data.schedule.notify ?? [],
      });
    }
    revalidatePath("/agents");
    redirect(`/agents/${agent.name}`);
  } catch (err: unknown) {
    // Next.js redirect() throws — must re-throw
    if (err && typeof err === "object" && "digest" in err) throw err;
    if (err instanceof Error && err.message.includes("duplicate key")) {
      throw new Error(`An agent named "${data.name}" already exists.`);
    }
    console.error("Failed to create agent:", err);
    throw new Error("Failed to create agent. Please try again.");
  }
}

export async function updateAgentAction(
  name: string,
  updates: Partial<{
    description: string;
    system_prompt: string | null;
    skills: string[];
    thread_lifetime: ThreadLifetime;
    trigger: AgentTrigger | null;
    tools: string[];
    subagents: string[];
    model_provider: LlmProvider | null;
    model: string | null;
    enabled: boolean;
    metadata: Record<string, unknown>;
  }>,
) {
  validateAgentName(name);
  validateAgentUpdates(updates as Record<string, unknown>);
  const agent = await getAgentByName(name);
  if (!agent) throw new Error("Agent not found");
  await updateAgent(agent.id, updates);
  revalidatePath(`/agents/${name}`);
  revalidatePath("/agents");
}

export async function deleteAgentAction(name: string) {
  validateAgentName(name);
  const agent = await getAgentByName(name);
  if (!agent) throw new Error("Agent not found");
  const settings = await getSettings();
  if (agent.name === settings.default_agent) {
    throw new Error("Cannot delete the default agent");
  }
  try {
    await deleteAgent(agent.id);
    revalidatePath("/agents");
    redirect("/agents");
  } catch (err: unknown) {
    // Next.js redirect() throws — must re-throw
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("Failed to delete agent:", err);
    throw new Error("Failed to delete agent. Please try again.");
  }
}

export async function toggleAgentAction(name: string, enabled: boolean) {
  validateAgentName(name);
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  const agent = await getAgentByName(name);
  if (!agent) throw new Error("Agent not found");
  await updateAgent(agent.id, { enabled });
  revalidatePath(`/agents/${name}`);
  revalidatePath("/agents");
}

// ─── Schedules ──────────────────────────────────────────────────────

const NOTIFY_TARGET_RE = /^(inbox|agent:[a-z][a-z0-9_]*(:(active))?|announce:[a-z][a-z0-9_]*)$/;

function validateNotifyTargets(targets: unknown): string[] {
  if (!Array.isArray(targets)) throw new Error("notify must be an array");
  if (targets.length > 20) throw new Error("Too many notification targets (max 20)");
  for (const t of targets) {
    if (typeof t !== "string" || !NOTIFY_TARGET_RE.test(t)) {
      throw new Error(`Invalid notification target: ${t}`);
    }
  }
  return targets as string[];
}

const VALID_EXPIRES = new Set(["1 hour", "24 hours", "72 hours", "168 hours", "720 hours", "never"]);

function validateNotifyExpires(value: unknown): string {
  if (typeof value !== "string" || !VALID_EXPIRES.has(value)) {
    throw new Error("Invalid notification expiry");
  }
  return value;
}

export async function createScheduleAction(data: {
  agent_name: string;
  name: string;
  cron: string;
  prompt: string;
  thread_lifetime?: ThreadLifetime;
  notify?: string[];
  notify_expires_after?: string;
}) {
  validateAgentName(data.agent_name);
  if (!data.name || data.name.length > 100)
    throw new Error("Schedule name is required (max 100 chars)");
  if (!data.cron || data.cron.length > 50) throw new Error("Cron expression is required");
  if (!isValidCron(data.cron)) throw new Error("Invalid cron expression — expected 5 fields: minute hour day month weekday");
  if (!data.prompt || data.prompt.length > 5000)
    throw new Error("Prompt is required (max 5000 chars)");

  const notify = data.notify?.length ? validateNotifyTargets(data.notify) : undefined;
  const notifyExpires = data.notify_expires_after
    ? validateNotifyExpires(data.notify_expires_after)
    : undefined;
  // "never" → null in the DB (no expiry)
  const notifyExpiresDb = notifyExpires === "never" ? null : notifyExpires;

  const agent = await getAgentByName(data.agent_name);
  if (!agent) throw new Error("Agent not found");

  try {
    const schedule = await createScheduleDb({
      agent_id: agent.id,
      name: data.name,
      cron: data.cron,
      prompt: data.prompt,
      thread_lifetime: data.thread_lifetime,
      notify,
      notify_expires_after: notifyExpiresDb,
    });
    revalidatePath(`/agents/${data.agent_name}`);
    return schedule;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("duplicate key")) {
      throw new Error(`A schedule named "${data.name}" already exists for this agent.`);
    }
    console.error("Failed to create schedule:", err);
    throw new Error("Failed to create schedule. Please try again.");
  }
}

export async function updateScheduleAction(
  id: string,
  agentName: string,
  updates: Partial<{
    cron: string;
    prompt: string;
    thread_lifetime: ThreadLifetime | null;
    enabled: boolean;
    notify: string[];
    notify_expires_after: string;
  }>,
) {
  if (!UUID_RE.test(id)) throw new Error("Invalid id");
  if (updates.cron !== undefined && (typeof updates.cron !== "string" || updates.cron.length > 50 || !isValidCron(updates.cron)))
    throw new Error("Invalid cron expression — expected 5 fields: minute hour day month weekday");
  if (
    updates.prompt !== undefined &&
    (typeof updates.prompt !== "string" || updates.prompt.length > 5000)
  )
    throw new Error("Prompt is too long (max 5000 chars)");
  if (
    updates.thread_lifetime !== undefined &&
    updates.thread_lifetime !== null &&
    !VALID_THREAD_LIFETIMES.has(updates.thread_lifetime as ThreadLifetime)
  )
    throw new Error("Invalid thread_lifetime");
  if (updates.enabled !== undefined && typeof updates.enabled !== "boolean")
    throw new Error("enabled must be a boolean");
  if (updates.notify !== undefined) validateNotifyTargets(updates.notify);
  if (updates.notify_expires_after !== undefined)
    validateNotifyExpires(updates.notify_expires_after);
  // "never" → null in the DB (no expiry)
  const dbUpdates = {
    ...updates,
    ...(updates.notify_expires_after === "never"
      ? { notify_expires_after: null }
      : {}),
  };
  try {
    await updateScheduleDb(id, dbUpdates);
    revalidatePath(`/agents/${agentName}`);
  } catch (err: unknown) {
    console.error("Failed to update schedule:", err);
    throw new Error("Failed to update schedule. Please try again.");
  }
}

export async function deleteScheduleAction(id: string, agentName: string) {
  if (!UUID_RE.test(id)) throw new Error("Invalid id");
  try {
    await deleteScheduleDb(id);
    revalidatePath(`/agents/${agentName}`);
  } catch (err: unknown) {
    console.error("Failed to delete schedule:", err);
    throw new Error("Failed to delete schedule. Please try again.");
  }
}

// ─── Channels ────────────────────────────────────────────────────────

const VALID_PLATFORMS = new Set<ChannelPlatform>(["telegram", "slack", "discord"]);

export async function createChannelAction(data: {
  agent_name: string;
  platform: ChannelPlatform;
  external_id: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  receive_announcements?: boolean;
}) {
  validateAgentName(data.agent_name);
  if (!VALID_PLATFORMS.has(data.platform)) throw new Error("Invalid platform");
  if (!data.external_id || data.external_id.length > 500)
    throw new Error("External ID is required (max 500 chars)");

  const agent = await getAgentByName(data.agent_name);
  if (!agent) throw new Error("Agent not found");

  try {
    const channel = await createChannelDb({
      agent_id: agent.id,
      platform: data.platform,
      external_id: data.external_id,
      config: data.config,
      enabled: data.enabled,
      receive_announcements: data.receive_announcements,
    });
    revalidatePath(`/agents/${data.agent_name}`);
    return channel;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("duplicate key")) {
      throw new Error("A channel with this platform and external ID already exists.");
    }
    console.error("Failed to create channel:", err);
    throw new Error("Failed to create channel. Please try again.");
  }
}

export async function updateChannelAction(
  id: string,
  agentName: string,
  updates: Partial<{
    config: Record<string, unknown>;
    enabled: boolean;
    receive_announcements: boolean;
  }>,
) {
  if (!UUID_RE.test(id)) throw new Error("Invalid id");
  try {
    await updateChannelDb(id, updates);
    revalidatePath(`/agents/${agentName}`);
  } catch (err: unknown) {
    console.error("Failed to update channel:", err);
    throw new Error("Failed to update channel. Please try again.");
  }
}

export async function deleteChannelAction(id: string, agentName: string) {
  if (!UUID_RE.test(id)) throw new Error("Invalid id");
  try {
    await deleteChannelDb(id);
    revalidatePath(`/agents/${agentName}`);
  } catch (err: unknown) {
    console.error("Failed to delete channel:", err);
    throw new Error("Failed to delete channel. Please try again.");
  }
}

export async function dismissNotificationAction(id: string) {
  if (!UUID_RE.test(id)) throw new Error("Invalid id");
  try {
    await dismissNotification(id);
    revalidatePath("/inbox");
    revalidatePath("/dashboard");
  } catch (err: unknown) {
    console.error("Failed to dismiss notification:", err);
    throw new Error("Failed to dismiss notification. Please try again.");
  }
}

// ─── Auth ───────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export async function loginAction(password: string): Promise<{ error?: string }> {
  const expected = process.env.EDDA_PASSWORD;
  if (!expected) return { error: "Authentication is not configured." };

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for") ?? "unknown";

  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt && entry.count >= MAX_ATTEMPTS) {
    return { error: "Too many attempts. Try again later." };
  }

  const passwordBuf = Buffer.from(password);
  const expectedBuf = Buffer.from(expected);
  if (passwordBuf.length !== expectedBuf.length || !timingSafeEqual(passwordBuf, expectedBuf)) {
    if (!entry || now >= entry.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    } else {
      entry.count++;
    }
    return { error: "Invalid password." };
  }

  loginAttempts.delete(ip);

  const token = await computeSessionToken(expected);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect("/login");
}
