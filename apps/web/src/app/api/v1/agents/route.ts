import { getAgents, createAgent } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseBody, badRequest } from "../_lib/helpers";

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, "Name must be lowercase alphanumeric with underscores"),
  description: z.string().min(1).max(2000),
  system_prompt: z.string().max(50_000).optional(),
  skills: z.array(z.string()).optional(),
  context_mode: z.enum(["isolated", "daily", "persistent"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET() {
  const agents = await getAgents();
  return jsonList(agents);
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = CreateAgentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const agent = await createAgent(parsed.data as Parameters<typeof createAgent>[0]);
  return NextResponse.json(agent, { status: 201 });
}
