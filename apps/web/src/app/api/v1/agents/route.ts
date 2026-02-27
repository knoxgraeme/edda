import { getAgents, createAgent, getSettings } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseBody, badRequest } from "../_lib/helpers";

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, "Name must be lowercase alphanumeric with underscores"),
  description: z.string().min(1).max(2000),
  system_prompt: z.string().max(50_000).optional(),
  skills: z.array(z.string()).optional(),
  thread_lifetime: z.enum(["ephemeral", "daily", "persistent"]).optional(),
  model: z.string().max(100).optional(),
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

  const settings = await getSettings();
  const agent = await createAgent({
    ...parsed.data,
    model: parsed.data.model || settings.default_model,
  });
  return NextResponse.json(agent, { status: 201 });
}
