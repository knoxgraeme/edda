/**
 * Notification system tests — target parsing, notify() dispatch, and tool invocation.
 *
 * DB query functions (createNotification, claimUnreadNotifications, etc.) are mocked.
 * These tests verify the orchestration logic in notify() and the send_notification tool.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockCreateNotification = vi.fn().mockResolvedValue({
  id: "notif-1",
  source_type: "schedule",
  source_id: "schedule-1",
  target_type: "inbox",
  target_id: null,
  summary: "test",
  detail: {},
  priority: "normal",
  status: "unread",
  expires_at: "2026-03-01T00:00:00Z",
  created_at: "2026-02-25T00:00:00Z",
});

const mockClaimUnreadNotifications = vi.fn().mockResolvedValue([]);
const mockGetAgentByName = vi.fn().mockResolvedValue(null);
const mockCreateTaskRun = vi.fn().mockResolvedValue({ id: "run-1" });
const mockStartTaskRun = vi.fn();
const mockCompleteTaskRun = vi.fn();
const mockFailTaskRun = vi.fn().mockResolvedValue(undefined);
const mockRefreshSettings = vi.fn().mockResolvedValue({ task_max_concurrency: 3 });
const mockGetUnreadNotifications = vi.fn().mockResolvedValue([]);
const mockMarkNotificationsRead = vi.fn();
const mockGetChannelsByAgent = vi.fn().mockResolvedValue([]);

vi.mock("@edda/db", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
  claimUnreadNotifications: (...args: unknown[]) => mockClaimUnreadNotifications(...args),
  getAgentByName: (...args: unknown[]) => mockGetAgentByName(...args),
  createTaskRun: (...args: unknown[]) => mockCreateTaskRun(...args),
  startTaskRun: (...args: unknown[]) => mockStartTaskRun(...args),
  completeTaskRun: (...args: unknown[]) => mockCompleteTaskRun(...args),
  failTaskRun: (...args: unknown[]) => mockFailTaskRun(...args),
  refreshSettings: (...args: unknown[]) => mockRefreshSettings(...args),
  getUnreadNotifications: (...args: unknown[]) => mockGetUnreadNotifications(...args),
  markNotificationsRead: (...args: unknown[]) => mockMarkNotificationsRead(...args),
  getChannelsByAgent: (...args: unknown[]) => mockGetChannelsByAgent(...args),
}));

// Mock build-agent to avoid pulling in the full agent stack
vi.mock("../agent/build-agent.js", () => ({
  buildAgent: vi.fn().mockResolvedValue({
    invoke: vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: "Notification processed." }],
    }),
  }),
  resolveThreadId: vi.fn().mockReturnValue("thread-1"),
}));

vi.mock("../agent/tool-helpers.js", () => ({
  resolveRetrievalContext: vi.fn(),
  extractLastAssistantMessage: vi.fn().mockReturnValue("Notification processed."),
  getAgentName: vi.fn().mockReturnValue("edda"),
}));

vi.mock("../utils/semaphore.js", () => ({
  runWithConcurrencyLimit: vi.fn((_max: number, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../utils/with-timeout.js", () => ({
  withTimeout: vi.fn((promise: Promise<unknown>) => promise),
}));

vi.mock("../utils/sanitize-error.js", () => ({
  sanitizeError: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err),
  ),
}));

import { notify } from "../utils/notify.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── notify() ───────────────────────────────────────────────────

describe("notify()", () => {
  it("is a no-op when targets is empty", async () => {
    await notify({
      sourceType: "schedule",
      sourceId: "schedule-1",
      targets: [],
      summary: "test",
    });

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("creates an inbox notification", async () => {
    await notify({
      sourceType: "schedule",
      sourceId: "schedule-1",
      targets: ["inbox"],
      summary: "Daily digest ready",
      detail: { run_id: "run-1" },
      priority: "normal",
      expiresAfter: "24 hours",
    });

    expect(mockCreateNotification).toHaveBeenCalledOnce();
    expect(mockCreateNotification).toHaveBeenCalledWith({
      source_type: "schedule",
      source_id: "schedule-1",
      target_type: "inbox",
      target_id: null,
      summary: "Daily digest ready",
      detail: { run_id: "run-1" },
      priority: "normal",
      expires_after: "24 hours",
    });
  });

  it("creates a passive agent notification without triggering a run", async () => {
    await notify({
      sourceType: "schedule",
      sourceId: "schedule-1",
      targets: ["agent:edda"],
      summary: "test",
    });

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        target_type: "agent",
        target_id: "edda",
      }),
    );
    // No active trigger — should not try to claim or create a run
    expect(mockClaimUnreadNotifications).not.toHaveBeenCalled();
    expect(mockCreateTaskRun).not.toHaveBeenCalled();
  });

  it("creates multiple notifications for multiple targets", async () => {
    await notify({
      sourceType: "schedule",
      sourceId: "schedule-1",
      targets: ["inbox", "agent:edda"],
      summary: "test",
    });

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ target_type: "inbox", target_id: null }),
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ target_type: "agent", target_id: "edda" }),
    );
  });

  it("triggers an agent run for active targets", async () => {
    mockGetAgentByName.mockResolvedValueOnce({
      id: "agent-1",
      name: "edda",
      enabled: true,
      thread_lifetime: "persistent",
      metadata: {},
    });
    mockClaimUnreadNotifications.mockResolvedValueOnce([
      {
        id: "notif-1",
        source_id: "schedule-1",
        summary: "Daily digest ready",
        detail: { run_id: "run-1" },
      },
    ]);

    await notify({
      sourceType: "schedule",
      sourceId: "schedule-1",
      targets: ["agent:edda:active"],
      summary: "Daily digest ready",
    });

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        target_type: "agent",
        target_id: "edda",
      }),
    );

    // triggerAgentRun runs via setImmediate — flush it
    await new Promise((r) => setImmediate(r));

    expect(mockGetAgentByName).toHaveBeenCalledWith("edda");
    expect(mockClaimUnreadNotifications).toHaveBeenCalledWith("edda");
    expect(mockCreateTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_name: "edda",
        trigger: "notification",
      }),
    );
  });

  it("skips agent run when claim returns empty (concurrent claim won)", async () => {
    mockGetAgentByName.mockResolvedValueOnce({
      id: "agent-1",
      name: "edda",
      enabled: true,
      thread_lifetime: "persistent",
      metadata: {},
    });
    mockClaimUnreadNotifications.mockResolvedValueOnce([]);

    await notify({
      sourceType: "schedule",
      sourceId: "schedule-1",
      targets: ["agent:edda:active"],
      summary: "test",
    });

    await new Promise((r) => setImmediate(r));

    expect(mockClaimUnreadNotifications).toHaveBeenCalledWith("edda");
    // Empty claim — no run created
    expect(mockCreateTaskRun).not.toHaveBeenCalled();
  });

  it("skips agent run when agent is disabled", async () => {
    mockGetAgentByName.mockResolvedValueOnce({
      id: "agent-1",
      name: "edda",
      enabled: false,
      thread_lifetime: "persistent",
      metadata: {},
    });

    await notify({
      sourceType: "schedule",
      sourceId: "schedule-1",
      targets: ["agent:edda:active"],
      summary: "test",
    });

    await new Promise((r) => setImmediate(r));

    expect(mockClaimUnreadNotifications).not.toHaveBeenCalled();
  });

  it("passes priority and expiresAfter through", async () => {
    await notify({
      sourceType: "agent",
      sourceId: "memory",
      targets: ["inbox"],
      summary: "Learned 5 new facts",
      priority: "high",
      expiresAfter: "48 hours",
    });

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "high",
        expires_after: "48 hours",
      }),
    );
  });

  it("throws on unknown target format", async () => {
    await expect(
      notify({
        sourceType: "system",
        sourceId: "system",
        targets: ["unknown_format"],
        summary: "test",
      }),
    ).rejects.toThrow("Unknown notification target format: 'unknown_format'");

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});

// ── send_notification tool ─────────────────────────────────────

describe("send_notification tool", () => {
  it("sends an inbox notification via notify()", async () => {
    const { sendNotificationTool } = await import(
      "../agent/tools/send-notification.js"
    );

    const result = await sendNotificationTool.invoke({
      target: "inbox",
      summary: "Test notification from agent",
    });

    const parsed = JSON.parse(result);
    expect(parsed.sent).toBe(true);
    expect(parsed.target).toBe("inbox");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "agent",
        target_type: "inbox",
        summary: "Test notification from agent",
      }),
    );
  });

  it("respects priority and expires_in_hours", async () => {
    const { sendNotificationTool } = await import(
      "../agent/tools/send-notification.js"
    );

    await sendNotificationTool.invoke({
      target: "agent:memory",
      summary: "Important update",
      priority: "high",
      expires_in_hours: 48,
    });

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "high",
        expires_after: "48 hours",
      }),
    );
  });
});
