import { NextRequest, NextResponse } from "next/server";
import { getAgentByName, getSchedulesForAgent, createSchedule } from "@edda/db";
import { notFound, badRequest } from "../../../_lib/helpers";

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
