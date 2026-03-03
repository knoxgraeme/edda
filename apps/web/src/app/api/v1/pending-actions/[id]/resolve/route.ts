import { NextResponse } from "next/server";
import { parseBody, badRequest, isUUID, getServerUrl } from "../../../_lib/helpers";

const SERVER_URL = getServerUrl();
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUUID(id)) return badRequest("Invalid action ID");

  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const { decision, resolved_by } = body as { decision?: string; resolved_by?: string };
  if (!decision || !["approved", "rejected"].includes(decision)) {
    return badRequest("decision must be 'approved' or 'rejected'");
  }

  const res = await fetch(`${SERVER_URL}/api/pending-actions/${id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(INTERNAL_API_SECRET ? { Authorization: `Bearer ${INTERNAL_API_SECRET}` } : {}),
    },
    body: JSON.stringify({ decision, resolved_by: resolved_by ?? "web" }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
