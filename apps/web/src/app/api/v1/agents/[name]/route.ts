import { getAgentByName, getSettings, updateAgent, deleteAgent } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, badRequest } from "../../_lib/helpers";

const UpdateAgentSchema = z
  .object({
    description: z.string().max(1000).optional(),
    system_prompt: z.string().max(50000).nullable().optional(),
    skills: z.array(z.string().max(100)).optional(),
    context_mode: z.enum(["isolated", "daily", "persistent"]).optional(),
    trigger: z.enum(["schedule", "on_demand"]).nullable().optional(),
    tools: z.array(z.string().max(100)).optional(),
    subagents: z.array(z.string().max(100)).optional(),
    model_settings_key: z.string().max(100).nullable().optional(),
    enabled: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentByName(name);
  if (!agent) return notFound("Agent");
  return NextResponse.json(agent);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentByName(name);
  if (!agent) return notFound("Agent");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updated = await updateAgent(agent.id, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentByName(name);
  if (!agent) return notFound("Agent");

  const settings = await getSettings();
  if (name === settings.default_agent) {
    return badRequest("Cannot delete the default agent");
  }

  await deleteAgent(agent.id);
  return NextResponse.json({ deleted: true });
}
