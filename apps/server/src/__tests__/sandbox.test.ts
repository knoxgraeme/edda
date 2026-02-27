/**
 * SecureSandbox tests — shell injection, denylist, allowlist, env stripping.
 *
 * Uses a mock SandboxBackendProtocol to test the wrapper logic without
 * needing a real VfsSandbox or filesystem.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SecureSandbox, BLOCKED_COMMANDS, SANDBOX_ENV_ALLOWLIST } from "../agent/sandbox.js";
import type { SandboxBackendProtocol, ExecuteResponse } from "deepagents";

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

function createMockBackend(): SandboxBackendProtocol {
  return {
    id: "mock-sandbox-123",
    execute: vi.fn(async (cmd: string): Promise<ExecuteResponse> => ({
      output: `executed: ${cmd}`,
      exitCode: 0,
      truncated: false,
    })),
    lsInfo: vi.fn(),
    read: vi.fn(),
    readRaw: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    grepRaw: vi.fn(),
    globInfo: vi.fn(),
  } as unknown as SandboxBackendProtocol;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SecureSandbox", () => {
  let mock: SandboxBackendProtocol;
  let sandbox: SecureSandbox;

  beforeEach(() => {
    mock = createMockBackend();
    sandbox = new SecureSandbox(mock);
  });

  describe("id", () => {
    it("delegates to inner backend", () => {
      expect(sandbox.id).toBe("mock-sandbox-123");
    });
  });

  describe("shell injection blocking", () => {
    const injections = [
      ["echo $DATABASE_URL", "$"],
      ["echo $(env)", "$"],
      ["echo `env`", "`"],
      ["ls; env", ";"],
      ["ls && env", "&&"],
      ["ls || env", "||"],
      ["ls | grep foo", "|"],
      ["echo hello\nenv", "\\n"],
      ["echo hello\renv", "\\r"],
    ] as const;

    for (const [cmd, reason] of injections) {
      it(`blocks ${reason} in: ${cmd.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}`, async () => {
        const result = await sandbox.execute(cmd);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("blocked");
        expect(mock.execute).not.toHaveBeenCalled();
      });
    }
  });

  describe("allowed commands", () => {
    const safe = [
      "node script.js",
      "node -e 'console.log(1)'",
      "python3 -c 'print({\"a\": 1})'",
      "grep 'fn()' src/index.ts",
      "node script.js 2>/dev/null",
      "node -e '[1,2].map(x => x)'",
      "curl https://example.com",
      "npm install express",
      "git log --oneline",
      "node script.js 2>&1",
    ];

    for (const cmd of safe) {
      it(`allows: ${cmd}`, async () => {
        const result = await sandbox.execute(cmd);
        expect(result.exitCode).toBe(0);
        expect(mock.execute).toHaveBeenCalled();
      });
    }
  });

  describe("command denylist", () => {
    const blocked = ["env", "sudo ls", "ssh host", "bash -c 'echo hi'", "/usr/bin/env"];

    for (const cmd of blocked) {
      it(`blocks: ${cmd}`, async () => {
        const result = await sandbox.execute(cmd);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("not permitted");
        expect(mock.execute).not.toHaveBeenCalled();
      });
    }
  });

  describe("command allowlist", () => {
    it("blocks commands not in allowlist when set", async () => {
      const restricted = new SecureSandbox(mock, new Set(["node", "npm"]));
      const result = await restricted.execute("python3 script.py");
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not in the allowed commands list");
    });

    it("allows commands in allowlist", async () => {
      const restricted = new SecureSandbox(mock, new Set(["node", "npm"]));
      const result = await restricted.execute("node script.js");
      expect(result.exitCode).toBe(0);
    });

    it("denylist overrides allowlist", async () => {
      const withDenied = new SecureSandbox(mock, new Set(["node", "env"]));
      const result = await withDenied.execute("env");
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not permitted");
    });
  });

  describe("env stripping", () => {
    it("prepends env -i prefix to executed commands", async () => {
      await sandbox.execute("node script.js");
      const call = (mock.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(call).toMatch(/^env -i /);
      expect(call).toContain("node script.js");
    });

    it("only forwards allowlisted env vars", async () => {
      await sandbox.execute("node script.js");
      const call = (mock.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // Should contain PATH (almost always set)
      if (process.env.PATH) {
        expect(call).toContain("PATH=");
      }
      // Should NOT contain any secret env vars
      expect(call).not.toContain("DATABASE_URL");
      expect(call).not.toContain("ANTHROPIC_API_KEY");
    });

    it("quotes env values with single quotes", async () => {
      await sandbox.execute("node script.js");
      const call = (mock.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // Each forwarded var should be quoted
      for (const key of SANDBOX_ENV_ALLOWLIST) {
        if (process.env[key]) {
          expect(call).toMatch(new RegExp(`${key}='[^']*'`));
        }
      }
    });
  });

  describe("stop", () => {
    it("delegates stop to inner when available", async () => {
      const mockWithStop = {
        ...createMockBackend(),
        stop: vi.fn(),
      };
      const sb = new SecureSandbox(mockWithStop as unknown as SandboxBackendProtocol);
      await sb.stop();
      expect(mockWithStop.stop).toHaveBeenCalled();
    });

    it("does not throw when inner has no stop", async () => {
      await expect(sandbox.stop()).resolves.not.toThrow();
    });
  });

  describe("BLOCKED_COMMANDS", () => {
    it("contains essential security commands", () => {
      expect(BLOCKED_COMMANDS.has("env")).toBe(true);
      expect(BLOCKED_COMMANDS.has("sudo")).toBe(true);
      expect(BLOCKED_COMMANDS.has("bash")).toBe(true);
      expect(BLOCKED_COMMANDS.has("ssh")).toBe(true);
    });
  });
});
