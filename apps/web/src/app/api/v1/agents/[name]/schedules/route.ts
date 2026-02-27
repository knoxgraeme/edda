import { NextRequest, NextResponse } from "next/server";
import { getAgentByName, getSchedulesForAgent, createSchedule } from "@edda/db";
import { notFound, badRequest } from "../../../_lib/helpers";

const CRON_FIELD_RE = /^(\*|(\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?|\*\/\d+)$/;
function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD_RE.test(f));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentByName(name);
  if (!agent) return notFound("Agent");
  const schedules = await getSchedulesForAgent(agent.id);
  return NextResponse.json(schedules);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentByName(name);
  if (!agent) return notFound("Agent");

  const body = await req.json();
  if (!body.name || !body.cron || !body.prompt) {
    return badRequest("name, cron, and prompt are required");
  }
  if (typeof body.name !== "string" || body.name.length > 100) {
    return badRequest("name must be a string (max 100 chars)");
  }
  if (typeof body.cron !== "string" || body.cron.length > 50 || !isValidCron(body.cron)) {
    return badRequest("Invalid cron expression — expected 5 fields: minute hour day month weekday");
  }
  if (typeof body.prompt !== "string" || body.prompt.length > 5000) {
    return badRequest("prompt must be a string (max 5000 chars)");
  }
  const VALID_THREAD_LIFETIMES = new Set(["ephemeral", "daily", "persistent"]);
  if (
    body.thread_lifetime !== undefined &&
    (typeof body.thread_lifetime !== "string" || !VALID_THREAD_LIFETIMES.has(body.thread_lifetime))
  ) {
    return badRequest("Invalid thread_lifetime");
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
    const schedule = await createSchedule({
      agent_id: agent.id,
      name: body.name,
      cron: body.cron,
      prompt: body.prompt,
      thread_lifetime: body.thread_lifetime ?? undefined,
      notify: body.notify,
      notify_expires_after: body.notify_expires_after,
    });
    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create schedule";
    const status = msg.includes("duplicate key") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
