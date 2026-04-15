import { getGraphData, type EntityType } from "@edda/db";
import { NextResponse } from "next/server";

const VALID_ENTITY_TYPES: readonly EntityType[] = [
  "person",
  "project",
  "company",
  "topic",
  "place",
  "tool",
  "concept",
] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entityLimit = Math.min(
    Math.max(parseInt(url.searchParams.get("entities") ?? "60", 10) || 60, 5),
    300,
  );
  const itemsPerEntity = Math.min(
    Math.max(parseInt(url.searchParams.get("items") ?? "8", 10) || 8, 0),
    50,
  );

  // Parse `types` as comma-separated list, silently drop unknowns.
  const typesRaw = url.searchParams.get("types");
  const types = typesRaw
    ? (typesRaw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t): t is EntityType =>
          (VALID_ENTITY_TYPES as readonly string[]).includes(t),
        ) as EntityType[])
    : undefined;

  // Parse `search` and trim. Empty string = no filter.
  const searchRaw = url.searchParams.get("search");
  const search = searchRaw?.trim() ? searchRaw.trim().slice(0, 200) : undefined;

  // Parse `min_links` (degree-based culling threshold). Clamped to [1, 10].
  const minItemLinks = Math.min(
    Math.max(parseInt(url.searchParams.get("min_links") ?? "1", 10) || 1, 1),
    10,
  );

  try {
    const data = await getGraphData({
      entityLimit,
      itemsPerEntity,
      types: types && types.length > 0 ? types : undefined,
      search,
      minItemLinks,
    });
    return NextResponse.json(data);
  } catch (err) {
    const message = "Failed to load graph data";
    console.error("[api/v1/graph] getGraphData failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
