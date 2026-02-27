# Plan: Agent Sandbox Execution Support

## Context

Edda agents currently have no shell execution capability. To enable agents to run CLI tools, install npm packages via `npx`, execute scripts, and perform data analysis, we need to add sandboxed `execute` support. The design follows from a detailed investigation comparing OpenClaw's exec model, deepagents' sandbox providers (VFS, Deno, Daytona), and Edda's deployment reality (Railway/Fly containers).

**Key design decisions:**
- **Sandbox = backend** (deepagents best practice) — when an agent has `execute`, the sandbox becomes the default backend in CompositeBackend. File ops and execute both happen inside the sandbox. Provider-swappable by env var.
- **Trigger:** if agent's scoped tools include `execute` AND `SANDBOX_PROVIDER` is set → sandbox enabled
- **Command scoping at skill level** — skills declare `allowed-commands` in SKILL.md frontmatter (same pattern as `allowed-tools`). Agent-level `execute` in `agent.tools[]` gets broad access (denylist only). Skills are specific, agents are broad.
- **Global command denylist** — baseline safety for all sandbox execution
- **Env stripping** — `env -i` on all executed commands to protect secrets
- **Provider config** — `SANDBOX_PROVIDER=node-vfs` (free default), swappable to `daytona`/`deno` later

## How deepagents handles `execute`

deepagents creates the `execute` tool internally and filters it based on `isSandboxBackend(backend)`:
- CompositeBackend delegates `execute()` to its **default backend** (first constructor arg)
- If default implements `SandboxBackendProtocol` → agent gets `execute` tool automatically
- If not → `execute` is filtered out

Edda's `scopeTools()` does NOT control `execute` — deepagents handles it. The control point is whether `buildBackend()` returns a sandbox-enabled default backend.

## Backend architecture with sandbox

```
CompositeBackend(defaultBackend, routes)
  /skills/      → StoreBackend (DB) — SKILL.md progressive disclosure
  /store/       → StoreBackend (DB) — agent persistent memory, cross-thread
  /store/{name} → StoreBackend (DB) — cross-agent store access
  /workspace/   → FilesystemBackend (disk) — optional, env-gated [existing]
  default       → SecureSandbox(VfsSandbox) — files + execute, in-memory
                  OR StateBackend — no execute (agents without sandbox)
```

When sandbox is the default: `write_file("script.js", ...)` then `execute("node script.js")` both happen in VFS — the file is there. All persistent data already routes to `/store/` (DB-backed), so nothing is lost.

## Implementation

### Step 1: Add sandbox config to `apps/server/src/config.ts`

Add to `envSchema` (after TELEGRAM section, ~line 54):
```typescript
// Sandbox execution (optional — omit to disable execute for all agents)
SANDBOX_PROVIDER: z.enum(["node-vfs", "daytona", "deno"]).optional(),
SANDBOX_TIMEOUT_MS: z.coerce.number().optional().default(30000),
```

### Step 2: Create `apps/server/src/agent/sandbox.ts`

New file with:

**a) Global command denylist:**
```typescript
const BLOCKED_COMMANDS = new Set([
  "env", "printenv", "set", "export",       // secrets/env inspection
  "kill", "killall", "shutdown", "reboot",   // process/system
  "mount", "umount", "mkfs", "fdisk",       // destructive system ops
  "ssh", "scp", "sftp", "telnet",           // network recon
  "apt", "apt-get", "yum", "apk", "brew",   // system package managers
  "su", "sudo",                              // privilege escalation
]);
```

**b) Env allowlist** (inverted from `mcp.ts` `BLOCKED_ENV_KEYS` pattern — allowlist is safer here):
```typescript
const SANDBOX_ENV_ALLOWLIST = new Set(["HOME", "PATH", "NODE_ENV", "TERM", "LANG"]);
```

**c) `SecureSandbox` wrapper** — wraps any `SandboxBackendProtocol`:
- Constructor: `(inner: SandboxBackendProtocol, allowedCommands?: Set<string>)`
- Must expose `readonly id: string` (from inner) and `execute()` method — deepagents uses duck-typing: `typeof backend.execute === "function" && typeof backend.id === "string"` to detect sandbox support
- `execute()`: if `allowedCommands` set → strict allowlist check. Otherwise → global denylist check. Then wraps command with `env -i` for env stripping. Delegates to inner.
- All other methods (`lsInfo`, `read`, `readRaw`, `write`, `edit`, `glob`, `grep`, `uploadFiles`, `downloadFiles`) → delegate to inner sandbox
- Note: VFS has no built-in env stripping — the `env -i` wrapping is essential to prevent secret leakage via `$DATABASE_URL` etc.

**d) `createSandbox()` factory:**
- Reads `SANDBOX_PROVIDER` from config
- `"node-vfs"` → `VfsSandbox.create({ timeout })` from `@langchain/node-vfs`
- `"daytona"` / `"deno"` → throw descriptive "not yet implemented" error
- Returns the raw `SandboxBackendProtocol` (wrapping in `SecureSandbox` happens in `buildBackend`)

### Step 3: Modify `apps/server/src/agent/backends.ts`

**Changes to `buildBackend()` signature:**
```typescript
export async function buildBackend(
  agent: Agent,
  store: BaseStore,
  options?: { sandboxEnabled?: boolean; allowedCommands?: Set<string> },
)
```

**In the async phase** (alongside existing fs config resolution):
- If `options.sandboxEnabled` and `SANDBOX_PROVIDER` is set → call `createSandbox()` → wrap in `SecureSandbox(sandbox, options.allowedCommands)`

**In the returned factory** (line 258):
```typescript
// Current:
return new CompositeBackend(new StateBackend(rt), routes);
// With sandbox:
const defaultBackend = secureSandbox ?? new StateBackend(rt);
return new CompositeBackend(defaultBackend, routes);
```

### Step 4: Modify `apps/server/src/agent/build-agent.ts`

**a) Add `parseAllowedCommands()`** — parallel to existing `parseAllowedTools()` (line 48):
Same YAML frontmatter parsing, reads `allowed-commands:` key. Returns `string[]`.

**b) Add `collectSkillCommands()`** — parallel to existing `collectSkillTools()` (line 69):
Iterates skills, union of `parseAllowedCommands()` results into `Set<string>`.

**c) Wire up after `scopeTools()`** (around line 502):
```typescript
// Determine if agent wants execute (from skills or agent.tools[])
const declaredTools = collectSkillTools(skills);
for (const t of agent.tools) declaredTools.add(t);
const wantsExecute = declaredTools.has("execute");

// Skill-level command allowlist (union). Empty = broad access (denylist only)
const skillCommands = collectSkillCommands(skills);
const allowedCommands = skillCommands.size > 0 ? skillCommands : undefined;

// Pass to buildBackend
const backend = await buildBackend(agent, store, {
  sandboxEnabled: wantsExecute,
  allowedCommands,
});
```

### Step 5: Add `@langchain/node-vfs` dependency

```bash
cd apps/server && pnpm add @langchain/node-vfs
```

### Step 6: Create `coding` skill

**`apps/server/src/skills/coding/SKILL.md`:**
```yaml
---
name: coding
description: >
  Shell execution skill for running code, scripts, and CLI tools
  in a sandboxed environment.
allowed-tools:
  - execute
allowed-commands:
  - node
  - npx
  - npm
  - git
  - python3
  - pip
  - cat
  - ls
  - head
  - tail
  - jq
  - curl
  - wget
---

# Coding

You have access to a sandboxed shell environment via the `execute` tool.

## When to use execute
- Running scripts you've written via write_file
- Installing packages (npm, pip)
- Running CLI tools (git, jq, curl)
- Building and testing code

## When NOT to use execute
- Reading files — use read_file instead
- Searching files — use grep/glob instead
- Writing files — use write_file instead
- These structured tools are faster and more reliable than shell equivalents

## Important
- The sandbox has no access to environment variables or secrets
- Installed packages are ephemeral (lost when the sandbox stops)
- Prefer structured Edda tools (search_items, create_item, etc.) over shell commands
```

### Step 7: Seed new skill

Update `packages/db/src/skills.ts` seed data to include `coding`.

## Files to create
- `apps/server/src/agent/sandbox.ts` — SecureSandbox wrapper, createSandbox factory, denylist constants
- `apps/server/src/skills/coding/SKILL.md` — coding skill with execute + allowed-commands

## Files to modify
- `apps/server/src/config.ts` — add SANDBOX_PROVIDER, SANDBOX_TIMEOUT_MS to envSchema
- `apps/server/src/agent/backends.ts` — accept sandbox options, use SecureSandbox as default backend when enabled
- `apps/server/src/agent/build-agent.ts` — add parseAllowedCommands/collectSkillCommands, detect execute, pass to buildBackend
- `apps/server/package.json` — add @langchain/node-vfs dependency
- `packages/db/src/skills.ts` — seed coding skill

## Security layers (defense in depth)
1. **Opt-in per agent** — only agents with `execute` in their skill/tools get sandbox
2. **Provider gate** — `SANDBOX_PROVIDER` must be set or no sandbox regardless of tools
3. **Env stripping** — `env -i` clears all env vars, only HOME/PATH/NODE_ENV/TERM/LANG passed through
4. **Global command denylist** — blocks env, sudo, ssh, apt, kill, etc.
5. **Skill-level command allowlist** — skills declare `allowed-commands`, union across skills = strict allowlist. Agent-level `execute` (no skills) = denylist only
6. **Timeout** — VFS configurable command timeout (default 30s)
7. **VFS filesystem isolation** — files in-memory, commands run in temp dir

## Verification
1. **Type check:** `pnpm type-check` passes
2. **Existing agents unaffected:** Without `SANDBOX_PROVIDER` set, all agents behave exactly as before
3. **Sandbox agent works:** Set `SANDBOX_PROVIDER=node-vfs`, create agent with `coding` skill, verify `execute` tool appears
4. **Command denylist:** `execute("env")`, `execute("sudo ls")` return blocked error
5. **Skill allowlist:** Agent with `coding` skill can run `node` but not `docker`
6. **Env stripping:** `execute("echo $DATABASE_URL")` returns empty
7. **Provider swap:** Change `SANDBOX_PROVIDER` value, verify different provider is used (Daytona/Deno throw "not yet implemented")
8. **File ops work:** `write_file("test.js", "console.log('hi')")` then `execute("node test.js")` outputs "hi"

## Future work (not in this PR)
- Cloud sandbox providers (Daytona, Deno, Sprites) — implement `createSandbox()` cases, same SecureSandbox wrapping
- Sandbox lifecycle — persist sandbox across turns (VFS factory pattern), cleanup on thread expiry
- Skill `requires` block — declarative prerequisites (bins, config) checked at load time
- Skill registry — discovery and install UX for MCP servers and skills
