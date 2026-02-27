import { listEntities, upsertEntity } from "@edda/db";
import type { EntityType } from "@edda/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonList, parseLimit, parseBody, badRequest } from "../_lib/helpers";

const VALID_ENTITY_TYPES: EntityType[] = [
  "person", "project", "company", "topic", "place", "tool", "concept",
];

const CreateEntitySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(VALID_ENTITY_TYPES as [string, ...string[]]),
  aliases: z.array(z.string()).optional(),
  description: z.string().max(5000).optional(),
});

export async function GET(request: Request) {
  const limit = parseLimit(request.url);
  const url = new URL(request.url);
  const rawType = url.searchParams.get("type");
  const type =
    rawType && VALID_ENTITY_TYPES.includes(rawType as EntityType)
      ? (rawType as EntityType)
      : undefined;
  const search = url.searchParams.get("search") ?? undefined;

  const entities = await listEntities({ type, search, limit });
  return jsonList(entities);
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const parsed = CreateEntitySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const entity = await upsertEntity(parsed.data as Parameters<typeof upsertEntity>[0]);
  return NextResponse.json(entity, { status: 201 });
}
