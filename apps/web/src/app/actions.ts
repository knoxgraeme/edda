"use server";

import { timingSafeEqual } from "crypto";
import {
  confirmPending,
  rejectPending,
  updateItem,
  updateEntity,
  getEntityItems,
  updateSettings,
  type Settings,
  type Entity,
  type Item,
} from "@edda/db";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { computeSessionToken, COOKIE_NAME, THIRTY_DAYS } from "@/lib/auth";

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
  await confirmPending(table, id);
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
  await updateItem(id, updates);
  revalidatePath("/dashboard");
}

export async function saveSettingsAction(updates: Partial<Settings>) {
  try {
    const saved = await updateSettings(updates);
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

  const token = computeSessionToken(expected);
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
