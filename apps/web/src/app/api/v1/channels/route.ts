import { getChannelsByAgent, createChannel, getAgentByName } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseBody, badRequest } from "../_lib/helpers";

const CreateChannelSchema = z.object({
  agent_name: z.string().min(1).max(100),
  platform: z.enum(["telegram", "slack", "discord"]),
  external_id: z.string().min(1).max(500),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  receive_announcements: z.boolean().optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get("agent_name");
  if (!agentName) return badRequest("agent_name query param is required");

  const agent = await getAgentByName(agentName);
  if (!agent) return badRequest("Agent not found");

  const channels = await getChannelsByAgent(agent.id, { includeDisabled: true });
  return jsonList(channels);
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = CreateChannelSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const agent = await getAgentByName(parsed.data.agent_name);
  if (!agent) return badRequest("Agent not found");

  try {
    const channel = await createChannel({
      agent_id: agent.id,
      platform: parsed.data.platform,
      external_id: parsed.data.external_id,
      config: parsed.data.config,
      enabled: parsed.data.enabled,
      receive_announcements: parsed.data.receive_announcements,
    });
    return NextResponse.json(channel, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return badRequest("A channel with this platform and external ID already exists.");
    }
    throw err;
  }
}
