/**
 * GET /api/v1/mcp-oauth/callback?code=...&state=...
 *
 * OAuth callback handler. Validates the state param, checks TTL,
 * then delegates token exchange to the server via internal API.
 *
 * This route is exempted from EDDA_PASSWORD auth in middleware.ts.
 * Compensating controls: single-use state param, 10-minute TTL.
 */

import { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  findConnectionByStateParam,
  getOAuthState,
  upsertOAuthState,
} from "@edda/db";

const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Generic error to avoid leaking state existence to unauthenticated callers
const GENERIC_ERROR = "Authorization failed — please try connecting again";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return new Response(GENERIC_ERROR, { status: 400 });
  }

  // 1. Find connection by state_param
  const connectionId = await findConnectionByStateParam(state);
  if (!connectionId) {
    return new Response(GENERIC_ERROR, { status: 400 });
  }

  // 2. Validate state — DB stores SHA-256 hash, so hash the incoming value
  const oauthState = await getOAuthState(connectionId);
  if (!oauthState?.pending_auth?.state_param) {
    return new Response(GENERIC_ERROR, { status: 400 });
  }

  const incomingHash = createHash("sha256").update(state).digest("hex");
  const expectedBuf = Buffer.from(oauthState.pending_auth.state_param);
  const actualBuf = Buffer.from(incomingHash);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return new Response(GENERIC_ERROR, { status: 400 });
  }

  // 3. Check TTL — reject if pending_auth is older than 10 minutes
  const updatedAt = new Date(oauthState.updated_at).getTime();
  if (Date.now() - updatedAt > PKCE_TTL_MS) {
    await upsertOAuthState(connectionId, { pending_auth: null });
    return new Response(GENERIC_ERROR, { status: 400 });
  }

  // 4. Delegate token exchange to the server
  try {
    const serverPort = process.env.PORT ?? "8000";
    const serverBase = process.env.INTERNAL_SERVER_URL ?? `http://localhost:${serverPort}`;
    const secret = process.env.INTERNAL_API_SECRET;

    const res = await fetch(`${serverBase}/internal/mcp-oauth/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        connection_id: connectionId,
        code,
        completion_secret: oauthState.pending_auth.completion_secret,
      }),
    });

    if (!res.ok) {
      console.error("[mcp-oauth] Server exchange failed:", res.status);
      return new Response(GENERIC_ERROR, { status: 500 });
    }

    // 5. Return success page
    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>Connected — Edda</title></head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h2>Connected successfully!</h2>
    <p>You can close this tab and return to your conversation.</p>
  </div>
</body>
</html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (err) {
    console.error("[mcp-oauth] Callback failed:", err);
    return new Response(GENERIC_ERROR, { status: 500 });
  }
}
