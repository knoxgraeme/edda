import { updateMcpConnection, deleteMcpConnection, getMcpConnectionById } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, notFound, badRequest, isUUID, notifyMcpInvalidate } from "../../_lib/helpers";
import { validateMcpConfig } from "../../_lib/mcp-config-schema";
import { probeMcpTools } from "@/lib/mcp-probe";

const UpdateMcpConnectionSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    transport: z.enum(["stdio", "sse", "streamable-http"]).optional(),
    config: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid connection ID");
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = UpdateMcpConnectionSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  // Transport-specific config validation (when config is provided)
  if (parsed.data.config) {
    let transport = parsed.data.transport;
    if (!transport) {
      const existing = await getMcpConnectionById(id);
      if (!existing) return notFound("MCP connection");
      transport = existing.transport as "stdio" | "sse" | "streamable-http";
    }
    const configResult = validateMcpConfig(transport, parsed.data.config);
    if ("error" in configResult) return badRequest(configResult.error);
    parsed.data.config = configResult.config;
  }

  const connection = await updateMcpConnection(id, parsed.data);
  if (!connection) return notFound("MCP connection");

  // Fire-and-forget: re-probe in background if transport or config changed
  if (parsed.data.transport || parsed.data.config) {
    probeMcpTools(connection)
      .then((tools) => updateMcpConnection(id, { discovered_tools: tools }))
      .catch((err) => console.warn(`[MCP] Re-probe failed for "${connection.name}": ${err}`));
  }

  // Notify server to reload MCP tools and rebuild agents
  notifyMcpInvalidate();

  return NextResponse.json(connection);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid connection ID");
  await deleteMcpConnection(id);

  // Notify server to reload MCP tools and rebuild agents
  notifyMcpInvalidate();

  return NextResponse.json({ deleted: true });
}
