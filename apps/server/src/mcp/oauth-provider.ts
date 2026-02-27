/**
 * MCPOAuthProvider — implements OAuthClientProvider from the MCP SDK,
 * backed by our DB (mcp_oauth_state table) for token/client storage.
 *
 * This is the only custom OAuth code needed. The SDK's auth() orchestrator
 * handles discovery, registration, PKCE, exchange, and refresh internally.
 */

import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthTokens,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createHash, randomBytes } from "crypto";
import { encrypt, decrypt } from "@edda/db";
import { getOAuthState, upsertOAuthState } from "@edda/db";
import { getLogger } from "../logger.js";

export class MCPOAuthProvider implements OAuthClientProvider {
  private _capturedAuthUrl: URL | null = null;
  private _stateParam: string | null = null;

  constructor(
    private connectionId: string,
    private baseUrl: string,
  ) {}

  get redirectUrl(): URL {
    return new URL(`${this.baseUrl}/api/v1/mcp-oauth/callback`);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl.toString()],
      client_name: "Edda",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  get capturedAuthUrl(): URL | null {
    return this._capturedAuthUrl;
  }

  async state(): Promise<string> {
    // Generate a crypto-random state param and hold it in memory
    // for saveCodeVerifier() to persist alongside the PKCE verifier
    this._stateParam = randomBytes(32).toString("hex");
    return this._stateParam;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const state = await getOAuthState(this.connectionId);
    if (!state?.tokens_encrypted) return undefined;
    try {
      return JSON.parse(decrypt(state.tokens_encrypted)) as OAuthTokens;
    } catch {
      getLogger().warn({ connectionId: this.connectionId }, "Failed to decrypt MCP OAuth tokens");
      return undefined;
    }
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
    try {
      return JSON.parse(decrypt(state.client_info_encrypted)) as OAuthClientInformationMixed;
    } catch {
      getLogger().warn({ connectionId: this.connectionId }, "Failed to decrypt MCP OAuth client info");
      return undefined;
    }
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
    if (!this._stateParam) {
      throw new Error("state() must be called before saveCodeVerifier()");
    }
    // Store SHA-256 hash of state_param — never persist the raw value
    const stateHash = createHash("sha256").update(this._stateParam).digest("hex");
    await upsertOAuthState(this.connectionId, {
      pending_auth: {
        code_verifier_encrypted: encrypt(codeVerifier),
        state_param: stateHash,
        completion_secret: encrypt(randomBytes(32).toString("hex")),
      },
    });
  }

  async codeVerifier(): Promise<string> {
    const state = await getOAuthState(this.connectionId);
    if (!state?.pending_auth?.code_verifier_encrypted) {
      throw new Error("No code verifier found — PKCE state may have been cleared");
    }
    return decrypt(state.pending_auth.code_verifier_encrypted);
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    switch (scope) {
      case "all":
        await upsertOAuthState(this.connectionId, {
          tokens_encrypted: null,
          client_info_encrypted: null,
          pending_auth: null,
          discovery_state: null,
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
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await upsertOAuthState(this.connectionId, {
      discovery_state: state as unknown as Record<string, unknown>,
    });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const state = await getOAuthState(this.connectionId);
    return (state?.discovery_state as unknown as OAuthDiscoveryState) ?? undefined;
  }
}
