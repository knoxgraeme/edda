import { updateChannel, deleteChannel } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, notFound, badRequest, isUUID } from "../../_lib/helpers";

const UpdateChannelSchema = z
  .object({
    config: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
    receive_announcements: z.boolean().optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid channel ID");

  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = UpdateChannelSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  try {
    const channel = await updateChannel(id, parsed.data);
    return NextResponse.json(channel);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("not found")) {
      return notFound("Channel");
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid channel ID");

  try {
    await deleteChannel(id);
    return NextResponse.json({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("not found")) {
      return notFound("Channel");
    }
    throw err;
  }
}
