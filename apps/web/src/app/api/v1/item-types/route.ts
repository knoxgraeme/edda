import { getItemTypes, createItemType } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseBody, badRequest } from "../_lib/helpers";

const CreateItemTypeSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  description: z.string().max(500).optional(),
  classification_hint: z.string().min(1).max(2000),
  metadata_schema: z.record(z.unknown()).optional(),
});

export async function GET() {
  const types = await getItemTypes();
  return jsonList(types);
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = CreateItemTypeSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const itemType = await createItemType(parsed.data as Parameters<typeof createItemType>[0]);
  return NextResponse.json(itemType, { status: 201 });
}
