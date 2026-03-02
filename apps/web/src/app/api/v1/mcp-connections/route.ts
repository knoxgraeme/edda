import { getMcpConnections, createMcpConnection, updateMcpConnection } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseBody, badRequest, notifyMcpInvalidate } from "../_lib/helpers";
import { validateMcpConfig } from "../_lib/mcp-config-schema";
import { probeMcpTools } from "@/lib/mcp-probe";

const CreateMcpConnectionSchema = z.object({
  name: z.string().min(1).max(200),
  transport: z.enum(["stdio", "sse", "streamable-http"]),
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

  // Transport-specific config validation
  const configResult = validateMcpConfig(parsed.data.transport, parsed.data.config);
  if ("error" in configResult) return badRequest(configResult.error);
  parsed.data.config = configResult.config;

  const connection = await createMcpConnection(
    parsed.data as Parameters<typeof createMcpConnection>[0],
  );

  // Fire-and-forget: probe in background, cache results when available
  probeMcpTools(connection)
    .then((tools) =>
      tools.length > 0 ? updateMcpConnection(connection.id, { discovered_tools: tools }) : null,
    )
    .catch((err) => console.warn(`[MCP] Probe failed for "${connection.name}": ${err}`));

  // Notify server to reload MCP tools and rebuild agents
  notifyMcpInvalidate();

  return NextResponse.json(connection, { status: 201 });
}
