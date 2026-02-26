# MCP OAuth Authentication

## Problem

MCP servers that require OAuth (e.g. `mcpmarket-gateway.fly.dev`) can't be connected — Edda only supports static Bearer tokens via env var indirection (`MCP_AUTH_*`). There's no way to do the OAuth redirect flow, store tokens, or refresh them.

## Key Discoveries

1. `@langchain/mcp-adapters` (v1.1.3, already installed) natively supports `authProvider` on streamable-http connections. We pass an `OAuthClientProvider` implementation directly — no custom transports needed.

2. `@modelcontextprotocol/sdk` (transitive dep, already installed) exports the **entire OAuth flow** as standalone functions: `auth()`, `discoverOAuthProtectedResourceMetadata()`, `discoverAuthorizationServerMetadata()`, `startAuthorization()`, `exchangeAuthorization()`, `refreshAuthorization()`, `registerClient()`. We should use these directly — not reimplement them.

3. The SDK's `auth()` orchestrator is the single entry point. It takes an `OAuthClientProvider` (storage/redirect adapter) and handles discovery, registration, PKCE, exchange, and refresh internally. **The only custom code we need is the provider implementation.**

## Design

### User Flow (Chat-Driven)

```
User: "connect to https://mcpmarket-gateway.fly.dev/test/fireeeeee/mcp"
  → Agent calls add_mcp_connection(url)
  → Tool probes URL, gets 401
  → Calls SDK's auth(provider, { serverUrl }) → returns 'REDIRECT'
  → Provider's redirectToAuthorization() captures the auth URL
  → Tool returns: { id, name, status: "pending_auth", auth_url: "https://..." }
  → User clicks link, authenticates in browser
  → Callback at /api/v1/mcp-oauth/callback receives code
  → Calls SDK's auth(provider, { serverUrl, authorizationCode }) → returns 'AUTHORIZED'
  → Tokens encrypted and stored via provider, tools probed, MCP client invalidated
  → Next agent interaction uses the authenticated connection
```

### Token Storage

Tokens stored encrypted in a new `mcp_oauth_state` table (not in config JSONB — keeps auth state separate from connection config). Full SDK `OAuthTokens` and `OAuthClientInformationMixed` objects stored as encrypted JSON blobs (not individual columns) for forward compatibility.

**Encryption:** AES-256-GCM via Node `crypto`. Key from `EDDA_ENCRYPTION_KEY` env var — **required** when any OAuth connection exists (no fallback). Fail loudly with a clear error. Format: `iv:ciphertext:tag` (base64).

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ add_mcp_connection tool                             │
│  1. Create connection in DB                         │
│  2. Probe URL                                       │
│  3. On 401 → call SDK auth(provider, { serverUrl }) │
│  4. SDK calls provider methods (saves PKCE state)   │
│  5. SDK returns 'REDIRECT'                          │
│  6. Tool reads captured auth URL from provider      │
│  7. Returns { status: "pending_auth", auth_url }    │
└──────────────────────┬──────────────────────────────┘
                       │
         User clicks link in chat
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ GET /api/v1/mcp-oauth/callback?code=...&state=...   │
│  1. Look up connection_id from state_param           │
│  2. Validate state with crypto.timingSafeEqual()     │
│  3. Call SDK auth(provider, { serverUrl, code })     │
│  4. SDK exchanges code, calls provider.saveTokens()  │
│  5. Update connection auth_status → "active"         │
│  6. Invalidate MCP client singleton (POST to server) │
│  7. Probe tools (fire-and-forget)                    │
│  8. Render "Connected! You can close this tab."      │
└─────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Runtime: buildAgent() → loadMCPTools()               │
│  For OAuth connections (auth_status = 'active'):     │
│  - MCPOAuthProvider reads encrypted tokens from DB  │
│  - Passed as authProvider to MultiServerMCPClient    │
│  - StreamableHTTPClientTransport handles 401→refresh │
│  Connections with pending_auth are EXCLUDED           │
└─────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Migration: `packages/db/migrations/XXX_mcp_oauth.sql`

```sql
-- Auth metadata on mcp_connections
ALTER TABLE mcp_connections
  ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'none'
    CHECK (auth_type IN ('none', 'bearer', 'oauth')),
  ADD COLUMN auth_status TEXT NOT NULL DEFAULT 'active'
    CHECK (auth_status IN ('active', 'pending_auth', 'error'));

-- OAuth state (1:1 with mcp_connections that use OAuth)
CREATE TABLE mcp_oauth_state (
  connection_id UUID PRIMARY KEY REFERENCES mcp_connections(id) ON DELETE CASCADE,

  -- Client registration (encrypted JSON of OAuthClientInformationMixed)
  client_info_encrypted TEXT,

  -- Tokens (encrypted JSON of full SDK OAuthTokens object)
  tokens_encrypted TEXT,
  expires_at TIMESTAMPTZ,

  -- Discovery cache (SDK's OAuthDiscoveryState as JSONB)
  discovery_state JSONB,

  -- PKCE (temporary, cleared after token exchange)
  pending_auth JSONB,  -- { code_verifier_encrypted, state_param, redirect_uri }

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_mcp_oauth_state_param
  ON mcp_oauth_state ((pending_auth->>'state_param'))
  WHERE pending_auth IS NOT NULL;
```

**Design decisions:**
- Discovery endpoints stored as JSONB (not individual columns) — resilient to SDK changes
- PKCE state stored as JSONB — temporary, cleared after exchange
- `code_verifier` encrypted within the JSONB (not plaintext)
- Full `OAuthTokens` stored as single encrypted blob (preserves `token_type`, `scope`, `id_token`)
- `state_param` indexed for callback lookup

### 2. Encryption: `apps/server/src/utils/crypto.ts`

```typescript
// AES-256-GCM encrypt/decrypt using Node crypto
// Key: EDDA_ENCRYPTION_KEY env var (32 bytes, base64) — REQUIRED for OAuth
// Format: base64(iv):base64(ciphertext):base64(authTag)
// No fallback — fail loudly if key not set

export function encrypt(plaintext: string): string;
export function decrypt(ciphertext: string): string;
export function getEncryptionKey(): Buffer; // throws if EDDA_ENCRYPTION_KEY not set
```

**Location rationale:** `apps/server/src/utils/` not `packages/db/` — encryption is a server-side concern. DB query functions accept/return opaque encrypted strings.

### 3. DB Queries: `packages/db/src/mcp-oauth.ts`

```typescript
// Stores/retrieves opaque encrypted strings — no crypto logic here
export async function getOAuthState(connectionId: string): Promise<McpOAuthStateRow | null>;
export async function upsertOAuthState(connectionId: string, patch: Partial<McpOAuthStateRow>): Promise<void>;
export async function deleteOAuthState(connectionId: string): Promise<void>;
export async function findConnectionByStateParam(stateParam: string): Promise<string | null>; // returns connection_id
```

Three functions aligned to CRUD, plus one for callback lookup. The provider in `apps/server` handles encrypt/decrypt before calling these.

### 4. OAuthClientProvider: `apps/server/src/agent/mcp-oauth-provider.ts`

The **only** custom OAuth code needed. Implements `OAuthClientProvider` from `@modelcontextprotocol/sdk` backed by our DB:

```typescript
import type { OAuthClientProvider, OAuthClientMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens, OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { getOAuthState, upsertOAuthState } from "@edda/db";

export class MCPOAuthProvider implements OAuthClientProvider {
  private _capturedAuthUrl: URL | null = null; // for tool to read after auth() returns 'REDIRECT'

  constructor(private connectionId: string, private baseUrl: string) {}

  get redirectUrl() { return new URL(`${this.baseUrl}/api/v1/mcp-oauth/callback`); }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl.toString()],
      client_name: "Edda",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  get capturedAuthUrl(): URL | null { return this._capturedAuthUrl; }

  async tokens(): Promise<OAuthTokens | undefined> {
    const state = await getOAuthState(this.connectionId);
    if (!state?.tokens_encrypted) return undefined;
    return JSON.parse(decrypt(state.tokens_encrypted));
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await upsertOAuthState(this.connectionId, {
      tokens_encrypted: encrypt(JSON.stringify(tokens)),
      expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      pending_auth: null, // clear PKCE state after successful exchange
    });
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const state = await getOAuthState(this.connectionId);
    if (!state?.client_info_encrypted) return undefined;
    return JSON.parse(decrypt(state.client_info_encrypted));
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await upsertOAuthState(this.connectionId, {
      client_info_encrypted: encrypt(JSON.stringify(info)),
    });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    // Server-side: capture URL for the tool to return to the agent
    this._capturedAuthUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const state = await getOAuthState(this.connectionId);
    const pending = state?.pending_auth ?? {};
    await upsertOAuthState(this.connectionId, {
      pending_auth: { ...pending, code_verifier_encrypted: encrypt(codeVerifier) },
    });
  }

  async codeVerifier(): Promise<string> {
    const state = await getOAuthState(this.connectionId);
    return decrypt(state!.pending_auth.code_verifier_encrypted);
  }

  // SDK calls this on auth failures (invalid_client, invalid_grant, etc.)
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    switch (scope) {
      case "all":
        await upsertOAuthState(this.connectionId, {
          tokens_encrypted: null, client_info_encrypted: null,
          pending_auth: null, discovery_state: null,
        });
        break;
      case "tokens":
        await upsertOAuthState(this.connectionId, { tokens_encrypted: null });
        break;
      case "client":
        await upsertOAuthState(this.connectionId, { client_info_encrypted: null });
        break;
      case "verifier":
        await upsertOAuthState(this.connectionId, { pending_auth: null });
        break;
      case "discovery":
        await upsertOAuthState(this.connectionId, { discovery_state: null });
        break;
    }
  }

  // Optional: cache discovery state
  async saveDiscoveryState(state: unknown): Promise<void> {
    await upsertOAuthState(this.connectionId, { discovery_state: state });
  }

  async discoveryState(): Promise<unknown | undefined> {
    const state = await getOAuthState(this.connectionId);
    return state?.discovery_state ?? undefined;
  }
}
```

### 5. Update `apps/server/src/agent/mcp.ts`

In `toMCPServerConfig()`, for connections with `auth_type: 'oauth'`:

```typescript
return {
  transport: "streamable-http" as const,
  url,
  authProvider: new MCPOAuthProvider(connection.id, EDDA_BASE_URL),
};
```

**Also update `_initMCPClient()`:** Filter out `pending_auth` connections to prevent initialization failures:

```typescript
const connections = (await getMcpConnections()).filter(
  (c) => c.auth_status !== "pending_auth"
);
```

### 6. Update `add_mcp_connection` tool

Keep the tool thin — delegate OAuth logic to SDK + provider:

```typescript
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

// After creating the connection:
// 1. Try to connect (probe)
// 2. If 401:
const provider = new MCPOAuthProvider(connection.id, EDDA_BASE_URL);
const result = await auth(provider, { serverUrl: new URL(url) });
if (result === "REDIRECT") {
  await updateMcpConnection(connection.id, { auth_type: "oauth", auth_status: "pending_auth" });
  return JSON.stringify({
    id: connection.id, name, status: "pending_auth",
    auth_url: provider.capturedAuthUrl!.toString(),
  });
}
// 3. If 'AUTHORIZED' (unlikely on first call) → proceed normally
// 4. If no auth needed → proceed as today
```

**SSRF protection:** Apply `validateMcpUrl()` to all URLs extracted from OAuth discovery metadata (authorization_endpoint, token_endpoint, etc.) before the SDK makes requests to them. This may require wrapping the SDK's fetch calls or validating discovered metadata after `auth()` populates discovery state.

### 7. Callback Route: `apps/web/src/app/api/v1/mcp-oauth/callback/route.ts`

```typescript
// GET /api/v1/mcp-oauth/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return new Response("Missing code or state", { status: 400 });

  // 1. Find connection by state_param
  const connectionId = await findConnectionByStateParam(state);
  if (!connectionId) return new Response("Invalid state", { status: 400 });

  // 2. Validate state with constant-time comparison
  //    (findConnectionByStateParam uses DB lookup; verify with timingSafeEqual)

  // 3. Check TTL — reject if pending_auth is older than 10 minutes
  const oauthState = await getOAuthState(connectionId);
  if (isExpired(oauthState.created_at, 10 * 60 * 1000)) {
    return new Response("Authorization expired", { status: 400 });
  }

  // 4. Exchange code for tokens via SDK
  const provider = new MCPOAuthProvider(connectionId, EDDA_BASE_URL);
  const connection = await getMcpConnectionById(connectionId);
  await auth(provider, { serverUrl: new URL(connection.config.url), authorizationCode: code });

  // 5. Update connection status
  await updateMcpConnection(connectionId, { auth_status: "active" });

  // 6. Invalidate MCP client singleton so next loadMCPTools() picks up the auth
  await invalidateMcpClientViaServer(); // POST to apps/server internal endpoint

  // 7. Return success page
  return new Response("<html>Connected successfully! You can close this tab.</html>",
    { headers: { "Content-Type": "text/html" } });
}
```

**Middleware exemption:** The callback path must be exempted from `EDDA_PASSWORD` auth in `apps/web/src/middleware.ts`, since the browser hitting this URL won't have the Edda session cookie. Compensating controls:
- State param is single-use (cleared after exchange)
- 10-minute TTL on PKCE state
- Rate limiting (5 req/min/IP)

### 8. Cross-App Communication

The callback route lives in `apps/web` but needs to invalidate the MCP client singleton in `apps/server`. Add `POST /internal/mcp-oauth/complete` to `apps/server` that calls `invalidateMCPClient()` and triggers tool re-probe. The callback route calls this after storing tokens. Clean separation — no cross-app imports.

### 9. New Env Vars

| Var | Required | Purpose |
|-----|----------|---------|
| `EDDA_ENCRYPTION_KEY` | When OAuth connections exist | 32-byte base64 key for AES-256-GCM. Generate with `openssl rand -base64 32`. No fallback — fails loudly. |
| `EDDA_BASE_URL` | For OAuth | Public URL of the Edda web app (for callback redirect URI) |

### 10. Types: `packages/db/src/types.ts`

```typescript
export type McpAuthType = "none" | "bearer" | "oauth";
export type McpAuthStatus = "active" | "pending_auth" | "error";

// Add to McpConnection interface:
auth_type: McpAuthType;
auth_status: McpAuthStatus;

// DB row type for mcp_oauth_state
export interface McpOAuthStateRow {
  connection_id: string;
  client_info_encrypted: string | null;
  tokens_encrypted: string | null;
  expires_at: string | null;
  discovery_state: Record<string, unknown> | null;
  pending_auth: { code_verifier_encrypted: string; state_param: string; redirect_uri: string } | null;
  created_at: string;
  updated_at: string;
}
```

### 11. Error Handling

| Failure | Response |
|---------|----------|
| `EDDA_ENCRYPTION_KEY` not set | Throw at `encrypt()`/`decrypt()` call time with clear message |
| Discovery timeout | Abort with timeout (use existing `withTimeout()`), return error to agent |
| Token exchange fails | Set `auth_status: 'error'`, clear PKCE state, return error to agent |
| Refresh fails | SDK calls `invalidateCredentials('tokens')`, connection falls back to re-auth |
| Decrypt fails (key changed) | Set `auth_status: 'error'`, log warning, require re-authentication |
| Callback state not found | Return 400 |
| Callback state expired (>10 min) | Return 400, clear stale PKCE state |

---

## Security Considerations

| Risk | Mitigation |
|------|------------|
| PKCE code_verifier in DB | Encrypted (not plaintext) within pending_auth JSONB |
| SSRF via discovery URLs | Apply `validateMcpUrl()` to all URLs from OAuth metadata |
| Callback auth bypass | Exempt from EDDA_PASSWORD but: single-use state, 10-min TTL, rate limiting |
| State timing attack | Use `crypto.timingSafeEqual()` for state comparison |
| Token leakage in chat | Auth URL contains only state param (not tokens). Document LangSmith exposure risk. |
| Encryption key compromise | No fallback key. Key rotation: re-encrypt all tokens with new key (manual migration). |
| Scope escalation | Request minimal scopes. Validate granted scope matches requested. |

---

## What We're NOT Building

- No web UI for OAuth management (chat-driven only)
- No multi-user OAuth (single-user app)
- No custom OAuth provider configuration — pure MCP spec discovery
- No `client_credentials` grant — only `authorization_code` + PKCE
- No token revocation endpoint
- No scope management UI
- No encryption key rotation automation (manual re-encrypt script if needed)

## Dependencies

- `@modelcontextprotocol/sdk` — for `OAuthClientProvider` interface and `auth()` orchestrator (already a transitive dep of `@langchain/mcp-adapters`)
- Node `crypto` — for AES-256-GCM (built-in, no new dep)
- **No new dependencies** — `pkce-challenge` not needed (SDK handles PKCE internally)

## File Checklist

| File | Action |
|------|--------|
| `packages/db/migrations/XXX_mcp_oauth.sql` | New — schema for OAuth state |
| `packages/db/src/mcp-oauth.ts` | New — CRUD queries (3 functions + state lookup) |
| `packages/db/src/types.ts` | Update — add `McpAuthType`, `McpAuthStatus`, `McpOAuthStateRow`, update `McpConnection` |
| `packages/db/src/mcp-connections.ts` | Update — add `auth_type`, `auth_status` to `MCP_UPDATE_COLUMNS` |
| `packages/db/src/index.ts` | Update — re-export new module |
| `apps/server/src/utils/crypto.ts` | New — `encrypt()`/`decrypt()` (AES-256-GCM) |
| `apps/server/src/agent/mcp-oauth-provider.ts` | New — `MCPOAuthProvider` implementing `OAuthClientProvider` |
| `apps/server/src/agent/mcp.ts` | Update — pass `authProvider` for OAuth connections, filter `pending_auth` from init |
| `apps/server/src/agent/tools/add-mcp-connection.ts` | Update — OAuth detection via SDK `auth()` |
| `apps/web/src/app/api/v1/mcp-oauth/callback/route.ts` | New — OAuth callback handler |
| `apps/web/src/middleware.ts` | Update — exempt callback path from EDDA_PASSWORD |
| `apps/server/src/config.ts` | Update — add `EDDA_BASE_URL`, `EDDA_ENCRYPTION_KEY` |

**4 new files** (down from 7 in v1 — eliminated `mcp-oauth.ts` flow logic and `crypto.ts` in wrong package).

## Test Strategy

| Area | Tests |
|------|-------|
| `crypto.ts` | Encrypt/decrypt round-trip, wrong key rejection, malformed ciphertext, missing key error |
| `MCPOAuthProvider` | Each interface method with mocked DB. `tokens()` returns undefined when empty. `saveTokens()` with full `OAuthTokens`. `invalidateCredentials()` clears correct scope. |
| `mcp-oauth.ts` (DB) | CRUD operations, `findConnectionByStateParam` lookup, upsert idempotency |
| `add_mcp_connection` | 401 detection → auth URL returned. No-auth → proceeds as before. |
| `callback route` | Valid code+state → tokens stored. Expired state → 400. Invalid state → 400. Missing params → 400. |
| `mcp.ts` | OAuth connections produce config with `authProvider`. `pending_auth` connections filtered from init. |

## Sources

- [MCP Authorization Spec (2025-03-26)](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/authorization/)
- [@modelcontextprotocol/sdk auth.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/auth.ts) — SDK's OAuth orchestrator (1474 lines)
- [@langchain/mcp-adapters](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters/) — authProvider support in v0.4.6+
- [langchain-mcp-adapters OAuth issue #239](https://github.com/langchain-ai/langchain-mcp-adapters/issues/239)
- [RFC 9728 — OAuth Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8414 — OAuth Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
