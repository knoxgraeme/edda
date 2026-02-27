import { NextResponse } from "next/server";

/** Standard list response envelope */
export function jsonList<T>(data: T[]) {
  return NextResponse.json({ data });
}

/** Parse ?limit= with defaults and bounds */
export function parseLimit(
  url: string,
  max = 200,
  defaultLimit = 50,
): number {
  const raw = parseInt(new URL(url).searchParams.get("limit") ?? String(defaultLimit), 10);
  if (isNaN(raw) || raw < 1) return defaultLimit;
  return Math.min(raw, max);
}

/** Safe JSON body parsing — returns unknown, callers must validate */
export async function parseBody(request: Request): Promise<unknown | NextResponse> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

/** Standard error responses */
export function notFound(resource: string) {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** UUID format check for path params */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Resolve the internal backend server URL.
 * Handles bare hostnames (e.g. "edda-server") by prepending http://.
 */
export function getServerUrl(): string {
  const raw = (process.env.SERVER_URL ?? "http://localhost:8000").trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `http://${raw}`;
}
