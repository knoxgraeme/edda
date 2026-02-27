import { batchCreateItems } from "@edda/db";
import type { ItemSource } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest } from "../../_lib/helpers";

const VALID_SOURCES: ItemSource[] = ["chat", "cli", "api", "cron", "agent", "posthook"];

const BatchItemSchema = z.object({
  type: z.string().min(1).max(100),
  content: z.string().min(1).max(50_000),
  source: z.enum(VALID_SOURCES as [string, ...string[]]).default("api"),
  metadata: z.record(z.unknown()).default({}),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  confirmed: z.boolean().default(true),
});

const BatchSchema = z.array(BatchItemSchema).min(1).max(100);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BatchSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const created = await batchCreateItems(
    parsed.data as Parameters<typeof batchCreateItems>[0],
  );
  return NextResponse.json({ data: created }, { status: 201 });
}
