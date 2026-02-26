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
  const VALID_CONTEXT_MODES = new Set(["isolated", "daily", "persistent"]);
  if (
    body.context_mode !== undefined &&
    (typeof body.context_mode !== "string" || !VALID_CONTEXT_MODES.has(body.context_mode))
  ) {
    return badRequest("Invalid context_mode");
  }

  try {
    const schedule = await createSchedule({
      agent_id: agent.id,
      name: body.name,
      cron: body.cron,
      prompt: body.prompt,
      context_mode: body.context_mode ?? undefined,
    });
    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create schedule";
    const status = msg.includes("duplicate key") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
