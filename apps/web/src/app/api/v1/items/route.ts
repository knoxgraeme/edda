import { getItemsByType, createItem } from "@edda/db";
import type { ItemSource } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseLimit, parseBody, badRequest } from "../_lib/helpers";

const VALID_SOURCES: ItemSource[] = ["chat", "cli", "api", "cron", "agent", "posthook"];

const CreateItemSchema = z.object({
  type: z.string().min(1).max(100),
  content: z.string().min(1).max(50_000),
  source: z.enum(VALID_SOURCES as [string, ...string[]]).default("api"),
  metadata: z.record(z.unknown()).default({}),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  confirmed: z.boolean().default(true),
});

export async function GET(request: Request) {
  const limit = parseLimit(request.url);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  if (!type) return badRequest("type query parameter is required");

  const items = await getItemsByType(type, status, limit);
  return jsonList(items);
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = CreateItemSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const item = await createItem(parsed.data as Parameters<typeof createItem>[0]);
  return NextResponse.json(item, { status: 201 });
}
