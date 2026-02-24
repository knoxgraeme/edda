import {
  getAgentDefinitionByName,
  updateAgentDefinition,
  deleteAgentDefinition,
} from "@edda/db";
import { NextResponse } from "next/server";
import { parseBody, notFound } from "../../_lib/helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentDefinitionByName(name);
  if (!agent) return notFound("Agent");
  return NextResponse.json(agent);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentDefinitionByName(name);
  if (!agent) return notFound("Agent");

  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const updated = await updateAgentDefinition(agent.id, body as Record<string, unknown>);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const agent = await getAgentDefinitionByName(name);
  if (!agent) return notFound("Agent");

  await deleteAgentDefinition(agent.id);
  return NextResponse.json({ deleted: true });
}
