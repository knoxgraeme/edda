"use server";

import { timingSafeEqual } from "crypto";
import {
  confirmPending,
  rejectPending,
  updateItem,
  updateEntity,
  getEntityItems,
  updateSettings,
  getAgentByName,
  createAgent,
  updateAgent,
  deleteAgent,
  type Settings,
  type Entity,
  type Item,
  type AgentContextMode,
  type AgentTrigger,
} from "@edda/db";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { computeSessionToken, COOKIE_NAME, THIRTY_DAYS } from "@/lib/auth";

// Mirrors UpdateSettingsSchema from /api/v1/settings/route.ts — keep in sync
const UpdateSettingsSchema = z
  .object({
    user_display_name: z.string().max(200).optional(),
    user_timezone: z.string().max(100).optional(),
    llm_provider: z
      .enum(["anthropic", "openai", "google", "groq", "ollama", "mistral", "bedrock"])
      .optional(),
    default_model: z.string().max(100).optional(),
    embedding_provider: z.enum(["voyage", "openai", "google"]).optional(),
    embedding_model: z.string().max(100).optional(),
    notification_targets: z.array(z.string()).optional(),
    context_refresh_cron: z.string().max(50).optional(),
    default_agent: z.string().min(1).max(200).optional(),
  })
  .strict();

const VALID_TABLES = new Set(["items", "entities", "item_types"] as const);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(["active", "done", "archived", "snoozed"] as const);
const MAX_BATCH_SIZE = 500;

function validateTable(table: string): asserts table is "items" | "entities" | "item_types" {
  if (!VALID_TABLES.has(table as "items" | "entities" | "item_types")) {
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
  table: "items" | "entities" | "item_types",
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
  table: "items" | "entities" | "item_types",
  id: string,
) {
  validateTable(table);
  validateId(id, table);
  await rejectPending(table, id);
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

export async function confirmAllPendingAction(
  items: Array<{ table: "items" | "entities" | "item_types"; id: string }>,
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
  const validated = UpdateSettingsSchema.parse(updates);
  try {
    const saved = await updateSettings(validated);
    revalidatePath("/settings");
    return saved;
  } catch (err) {
    console.error("Failed to save settings:", err);
    throw new Error("Failed to save settings. Please try again.");
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

const VALID_CONTEXT_MODES = new Set<AgentContextMode>(["isolated", "daily", "persistent"]);
const VALID_TRIGGERS = new Set<AgentTrigger>(["schedule", "on_demand"]);

// System agents seeded by migrations — cannot be deleted from the UI
const SYSTEM_AGENTS = new Set(["edda", "digest", "maintenance", "memory"]);

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
  if (updates.context_mode != null && !VALID_CONTEXT_MODES.has(updates.context_mode as AgentContextMode)) {
    throw new Error("Invalid context_mode");
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
  if (updates.enabled != null && typeof updates.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
}

export async function createAgentAction(data: {
  name: string;
  description: string;
  system_prompt?: string;
  skills?: string[];
  context_mode?: AgentContextMode;
  trigger?: AgentTrigger;
  tools?: string[];
  metadata?: Record<string, unknown>;
}) {
  validateAgentName(data.name);

  if (!data.description || data.description.length > MAX_DESCRIPTION_LEN) {
    throw new Error(`Description is required (max ${MAX_DESCRIPTION_LEN} chars)`);
  }
  if (data.system_prompt && data.system_prompt.length > MAX_SYSTEM_PROMPT_LEN) {
    throw new Error(`System prompt too long (max ${MAX_SYSTEM_PROMPT_LEN} chars)`);
  }

  const contextMode = data.context_mode ?? "isolated";
  if (!VALID_CONTEXT_MODES.has(contextMode)) {
    throw new Error("Invalid context_mode");
  }
  if (data.trigger && !VALID_TRIGGERS.has(data.trigger)) {
    throw new Error("Invalid trigger");
  }

  try {
    const agent = await createAgent({
      name: data.name,
      description: data.description,
      system_prompt: data.system_prompt,
      skills: data.skills ?? [],
      context_mode: contextMode,
      trigger: data.trigger,
      tools: data.tools ?? [],
      metadata: data.metadata,
    });
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
    context_mode: AgentContextMode;
    trigger: AgentTrigger | null;
    tools: string[];
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
  if (SYSTEM_AGENTS.has(agent.name)) {
    throw new Error("Cannot delete system agent");
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
