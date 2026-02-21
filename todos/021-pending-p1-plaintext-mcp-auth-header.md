---
status: complete
priority: p1
issue_id: "021"
tags: [code-review, security, credentials, mcp]
dependencies: []
---

# Problem Statement
`add_mcp_connection` accepts a raw `auth_header` value and stores it as plaintext in `mcp_connections.config` JSONB. Credentials should never touch the DB. Since Edda is self-hosted and MCP servers are either owned by the user or use static API keys, the right pattern is to store only an env var **name** in the DB and resolve the actual secret from the environment at connection time.

# Design Decision
OAuth flow for MCP is complex (token rotation, refresh, browser redirect) and unnecessary for the primary use case. The right machine-to-machine pattern: generate a long-lived API key on the MCP server, set it as a Railway/`.env` secret, reference it by name in Edda.

```
# Railway secrets / .env
MCP_MYSERVICE_TOKEN=sk-edda-xxxx
```

The DB stores only `{ url, auth_env_var: "MCP_MYSERVICE_TOKEN" }` — the actual token never leaves the environment.

# Findings
Flagged by: security-sentinel (High severity)

- `apps/server/src/agent/tools/add-mcp-connection.ts` lines 17–26: `auth_header` written directly into `config` JSONB
- `packages/db/src/mcp-connections.ts`: `getMcpConnections()` returns full config with credential
- `apps/server/src/agent/tools/list-mcp-connections.ts`: returns full config to agent

# Proposed Solution

## Schema change
Replace `auth_header` with `auth_env_var` in `addMcpConnectionSchema`:

```typescript
auth_env_var: z.string().optional()
  .describe("Name of the env var holding the Bearer token (e.g. MCP_MYSERVICE_TOKEN). Set the actual secret in Railway secrets or .env — never pass the token value directly."),
```

## Tool handler
```typescript
const config: Record<string, unknown> = { url };
if (auth_env_var) config.auth_env_var = auth_env_var; // store name only, not value
const connection = await createMcpConnection({ name, transport: "sse", config });
```

## loadMCPTools() — resolve at connection time
```typescript
const authToken = conn.config.auth_env_var
  ? process.env[conn.config.auth_env_var as string]
  : undefined;
const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
// use headers when opening SSE connection
```

## .env.example
Add `# MCP_MYSERVICE_TOKEN=your-token-here` with a comment explaining the pattern.

# Technical Details
- `apps/server/src/agent/tools/add-mcp-connection.ts`
- `apps/server/src/agent/tools/list-mcp-connections.ts` (no change needed — env var name is safe to return)
- `apps/server/src/agent/mcp.ts` (loadMCPTools — resolves env var at connection time)
- `.env.example`

# Acceptance Criteria
- [ ] `add_mcp_connection` schema uses `auth_env_var` not `auth_header`
- [ ] DB config stores only the env var name
- [ ] `loadMCPTools()` resolves `process.env[auth_env_var]` at connection time
- [ ] `.env.example` documents the `MCP_*` pattern
- [ ] No credential value ever written to DB

# Work Log
- 2026-02-20: Created from security-sentinel review
- 2026-02-20: Updated — env var reference pattern chosen over DB encryption. OAuth full flow deferred. Long-lived API keys are the right machine-to-machine pattern for self-hosted use.
