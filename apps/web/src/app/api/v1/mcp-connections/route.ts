import { getMcpConnections, createMcpConnection } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseBody, badRequest } from "../_lib/helpers";

const CreateMcpConnectionSchema = z.object({
  name: z.string().min(1).max(200),
  transport: z.enum(["stdio", "sse"]),
  config: z.record(z.unknown()),
});

export async function GET() {
  const connections = await getMcpConnections();
  return jsonList(connections);
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = CreateMcpConnectionSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const connection = await createMcpConnection(
    parsed.data as Parameters<typeof createMcpConnection>[0],
  );
  return NextResponse.json(connection, { status: 201 });
}
