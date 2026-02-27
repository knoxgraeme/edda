import { NextRequest, NextResponse } from "next/server";
import { updateSchedule, deleteSchedule } from "@edda/db";
import { badRequest, isUUID, notFound } from "../../_lib/helpers";

const CRON_FIELD_RE = /^(\*|(\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?|\*\/\d+)$/;
function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD_RE.test(f));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid id");

  const body = await req.json();

  const VALID_THREAD_LIFETIMES = new Set(["ephemeral", "daily", "persistent"]);
  if (body.cron !== undefined && (typeof body.cron !== "string" || body.cron.length > 50 || !isValidCron(body.cron))) {
    return badRequest("Invalid cron expression — expected 5 fields: minute hour day month weekday");
  }
  if (body.prompt !== undefined && (typeof body.prompt !== "string" || body.prompt.length > 5000)) {
    return badRequest("prompt must be a string (max 5000 chars)");
  }
  if (
    body.thread_lifetime !== undefined &&
    body.thread_lifetime !== null &&
    (typeof body.thread_lifetime !== "string" || !VALID_THREAD_LIFETIMES.has(body.thread_lifetime))
  ) {
    return badRequest("Invalid thread_lifetime");
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return badRequest("enabled must be a boolean");
  }

  const NOTIFY_TARGET_RE = /^(inbox|agent:[a-z][a-z0-9_]*(:(active))?|announce:[a-z][a-z0-9_]*)$/;
  if (body.notify !== undefined) {
    if (!Array.isArray(body.notify) || body.notify.length > 20) {
      return badRequest("notify must be an array (max 20 targets)");
    }
    for (const t of body.notify) {
      if (typeof t !== "string" || !NOTIFY_TARGET_RE.test(t)) {
        return badRequest(`Invalid notification target: ${t}`);
      }
    }
  }

  const VALID_EXPIRES = new Set(["1 hour", "24 hours", "72 hours", "168 hours", "720 hours", "never"]);
  if (body.notify_expires_after !== undefined) {
    if (typeof body.notify_expires_after !== "string" || !VALID_EXPIRES.has(body.notify_expires_after)) {
      return badRequest("Invalid notify_expires_after");
    }
  }

  try {
    const schedule = await updateSchedule(id, body);
    return NextResponse.json(schedule);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid id");

  try {
    await deleteSchedule(id);
    return NextResponse.json({ ok: true });
  } catch {
    return notFound("Schedule");
  }
}
