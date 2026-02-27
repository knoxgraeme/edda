/**
 * Sandboxed execution for agents.
 *
 * SecureSandbox wraps any SandboxBackendProtocol with:
 * - Shell injection prevention (blocks $, `, ;, &&, ||, and | to prevent
 *   env var expansion and command chaining)
 * - Global command denylist (always checked, even with an allowlist)
 * - Optional skill-level command allowlist (strict positive match)
 * - Env stripping via env -i (only HOME/PATH/NODE_ENV/TERM/LANG forwarded)
 *
 * SECURITY MODEL: This is a guardrail, not a security boundary. VfsSandbox
 * passes process.env to its spawned bash shell — blocking $ prevents bash
 * from expanding env vars, and env -i ensures child processes (node, python)
 * inherit a clean env. But there is no process or filesystem isolation.
 * For untrusted agents or production use, use a container-based sandbox
 * provider (Daytona, Deno, Docker) instead of node-vfs.
 */

import * as path from "node:path";
import { VfsSandbox } from "@langchain/node-vfs";
import type { SandboxBackendProtocol, ExecuteResponse } from "deepagents";
import type { Settings } from "@edda/db";
import { loadConfig } from "../config.js";
import { getLogger } from "../logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Command names that are always blocked regardless of allowlist. */
export const BLOCKED_COMMANDS = new Set([
  // env inspection
  "env",
  "printenv",
  "set",
  "export",
  "declare",
  "compgen",
  "typeset",
  // privilege escalation
  "su",
  "sudo",
  "chroot",
  "nsenter",
  "unshare",
  // process/system
  "kill",
  "killall",
  "shutdown",
  "reboot",
  // destructive system ops
  "mount",
  "umount",
  "mkfs",
  "fdisk",
  "dd",
  // network recon
  "ssh",
  "scp",
  "sftp",
  "telnet",
  "nc",
  "ncat",
  "socat",
  // system package managers
  "apt",
  "apt-get",
  "yum",
  "apk",
  "brew",
  // shell spawning (bypass sandbox)
  "bash",
  "sh",
  "zsh",
  "dash",
  "eval",
  "source",
  "exec",
]);

/** Only these env vars are forwarded to sandboxed commands. */
export const SANDBOX_ENV_ALLOWLIST = new Set(["HOME", "PATH", "NODE_ENV", "TERM", "LANG"]);

/**
 * Patterns that enable env var leakage or command injection.
 *
 * We block the minimal set that prevents secrets from leaking:
 * - $ and backticks: prevent bash from expanding env vars
 * - ; && || |: prevent chaining blocked commands after allowed ones
 *
 * We intentionally allow > < () {} \ so that normal commands work:
 *   node -e 'arr.map(x => x)'         — uses >
 *   python3 -c 'print({"a": 1})'      — uses { }
 *   grep "fn()" src/*.ts               — uses ( )
 *   node script.js 2>/dev/null         — uses >
 *
 * Newlines/carriage returns are blocked because bash treats them as
 * command separators (equivalent to ;).
 */
const SHELL_INJECTION = /\$|`|;|&&|\|\||\||\n|\r/;

// ---------------------------------------------------------------------------
// SecureSandbox
// ---------------------------------------------------------------------------

const blocked = (output: string): ExecuteResponse => ({ output, exitCode: 1, truncated: false });

export class SecureSandbox implements SandboxBackendProtocol {
  private inner: SandboxBackendProtocol;
  private allowedCommands?: Set<string>;
  private envPrefix: string;
  private log;

  constructor(inner: SandboxBackendProtocol, allowedCommands?: Set<string>) {
    this.inner = inner;
    this.allowedCommands = allowedCommands;
    this.log = getLogger();

    // Cache the env -i prefix — these don't change during process lifetime.
    // Values are single-quoted to prevent breakage from spaces/special chars.
    const allowedEnvArgs = [...SANDBOX_ENV_ALLOWLIST]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => {
        const val = (process.env[key] ?? "").replace(/'/g, "'\\''");
        return `${key}='${val}'`;
      })
      .join(" ");
    this.envPrefix = `env -i ${allowedEnvArgs} `;
  }

  get id(): string {
    return this.inner.id;
  }

  async execute(command: string): Promise<ExecuteResponse> {
    // 1. Reject shell injection — prevents $VAR expansion and command chaining
    if (SHELL_INJECTION.test(command)) {
      this.log.debug({ command }, "Sandbox: shell injection pattern blocked");
      return blocked(
        "Command blocked: $, `, ;, &&, ||, and | are not permitted in the sandbox",
      );
    }

    // 2. Extract the base command (first word, strip path prefix)
    const firstWord = command.trim().split(/\s+/)[0] ?? "";
    const baseCommand = path.basename(firstWord);

    // 3. Always check denylist first (defense in depth, even with allowlist)
    if (BLOCKED_COMMANDS.has(baseCommand)) {
      this.log.debug({ baseCommand, command }, "Sandbox: command in denylist");
      return blocked(`Command blocked: '${baseCommand}' is not permitted in the sandbox`);
    }

    // 4. Allowlist check if present (strict positive match)
    if (this.allowedCommands && this.allowedCommands.size > 0) {
      if (!this.allowedCommands.has(baseCommand)) {
        this.log.debug({ baseCommand, command }, "Sandbox: command not in allowlist");
        return blocked(`Command blocked: '${baseCommand}' is not in the allowed commands list`);
      }
    }

    this.log.debug({ baseCommand, command }, "Sandbox: executing command");
    return this.inner.execute(this.envPrefix + command);
  }

  // -- Delegate all other BackendProtocol methods to inner --------------------

  lsInfo(...args: Parameters<SandboxBackendProtocol["lsInfo"]>) {
    return this.inner.lsInfo(...args);
  }

  read(...args: Parameters<SandboxBackendProtocol["read"]>) {
    return this.inner.read(...args);
  }

  readRaw(...args: Parameters<SandboxBackendProtocol["readRaw"]>) {
    return this.inner.readRaw(...args);
  }

  write(...args: Parameters<SandboxBackendProtocol["write"]>) {
    return this.inner.write(...args);
  }

  edit(...args: Parameters<SandboxBackendProtocol["edit"]>) {
    return this.inner.edit(...args);
  }

  uploadFiles(...args: Parameters<NonNullable<SandboxBackendProtocol["uploadFiles"]>>) {
    if (!this.inner.uploadFiles) {
      throw new Error("uploadFiles is not supported by the sandbox backend");
    }
    return this.inner.uploadFiles(...args);
  }

  downloadFiles(...args: Parameters<NonNullable<SandboxBackendProtocol["downloadFiles"]>>) {
    if (!this.inner.downloadFiles) {
      throw new Error("downloadFiles is not supported by the sandbox backend");
    }
    return this.inner.downloadFiles(...args);
  }

  grepRaw(...args: Parameters<SandboxBackendProtocol["grepRaw"]>) {
    return this.inner.grepRaw(...args);
  }

  globInfo(...args: Parameters<SandboxBackendProtocol["globInfo"]>) {
    return this.inner.globInfo(...args);
  }

  /** Clean up sandbox resources (temp dirs, VFS). */
  async stop(): Promise<void> {
    if ("stop" in this.inner && typeof this.inner.stop === "function") {
      await this.inner.stop();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createSandbox(
  settings: Settings,
): Promise<SandboxBackendProtocol | null> {
  const provider = settings.sandbox_provider;

  if (!provider || provider === "none") {
    return null;
  }

  switch (provider) {
    case "node-vfs": {
      const { SANDBOX_TIMEOUT_MS: timeout } = loadConfig();
      return VfsSandbox.create({ timeout });
    }

    default:
      throw new Error(`Unknown sandbox provider: '${provider}'`);
  }
}
