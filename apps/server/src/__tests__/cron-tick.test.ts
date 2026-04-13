/**
 * Unit tests for the cron tick pipeline.
 *
 * These tests verify the *control flow* of runCronTick, drainReminders,
 * and fireDueSchedules — DB calls and agent execution are mocked. The goal
 * is to lock down the three invariants that make http_trigger mode safe:
 *
 *   1. drainReminders() fires every reminder returned by claimDueReminders
 *      and advances/completes each one.
 *   2. fireDueSchedules() uses cron-parser's prev() and the schedule's
 *      last_fired_at column to decide what's due — it does NOT fire
 *      schedules whose prev() is <= last_fired_at.
 *   3. runScheduleOnce() CAS-claims via claimScheduleFire before doing any
 *      work, so a lost claim is a no-op (no double-fire).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockClaimDueReminders = vi.fn().mockResolvedValue([]);
const mockAdvanceReminderByDate = vi.fn().mockResolvedValue(undefined);
const mockAdvanceReminderByInterval = vi.fn().mockResolvedValue(undefined);
const mockCompleteReminder = vi.fn().mockResolvedValue(undefined);
const mockResetStuckSendingReminders = vi.fn().mockResolvedValue(0);
const mockDeleteExpiredNotifications = vi.fn().mockResolvedValue(0);
const mockExpirePendingActions = vi.fn().mockResolvedValue(0);

const mockGetEnabledSchedules = vi.fn().mockResolvedValue([]);
const mockClaimScheduleFire = vi.fn().mockResolvedValue(true);
const mockGetScheduleById = vi.fn();
const mockGetAgentByName = vi.fn();
const mockCreateTaskRun = vi.fn().mockResolvedValue({ id: "run-1" });
const mockCountItemsOfTypeSince = vi.fn().mockResolvedValue(0);
const mockGetUnreadNotifications = vi.fn().mockResolvedValue([]);
const mockMarkNotificationsRead = vi.fn().mockResolvedValue(undefined);

const mockGetSettings = vi.fn().mockResolvedValue({
  user_timezone: "UTC",
  task_max_concurrency: 3,
  default_model: "claude-sonnet-4-6",
});
const mockRefreshSettings = vi.fn().mockResolvedValue({
  user_timezone: "UTC",
  task_max_concurrency: 3,
  default_model: "claude-sonnet-4-6",
});

vi.mock("@edda/db", () => ({
  claimDueReminders: (...args: unknown[]) => mockClaimDueReminders(...args),
  advanceReminderByDate: (...args: unknown[]) => mockAdvanceReminderByDate(...args),
  advanceReminderByInterval: (...args: unknown[]) => mockAdvanceReminderByInterval(...args),
  completeReminder: (...args: unknown[]) => mockCompleteReminder(...args),
  resetStuckSendingReminders: (...args: unknown[]) => mockResetStuckSendingReminders(...args),
  deleteExpiredNotifications: (...args: unknown[]) => mockDeleteExpiredNotifications(...args),
  expirePendingActions: (...args: unknown[]) => mockExpirePendingActions(...args),
  getEnabledSchedules: (...args: unknown[]) => mockGetEnabledSchedules(...args),
  claimScheduleFire: (...args: unknown[]) => mockClaimScheduleFire(...args),
  getScheduleById: (...args: unknown[]) => mockGetScheduleById(...args),
  getAgentByName: (...args: unknown[]) => mockGetAgentByName(...args),
  createTaskRun: (...args: unknown[]) => mockCreateTaskRun(...args),
  countItemsOfTypeSince: (...args: unknown[]) => mockCountItemsOfTypeSince(...args),
  getUnreadNotifications: (...args: unknown[]) => mockGetUnreadNotifications(...args),
  markNotificationsRead: (...args: unknown[]) => mockMarkNotificationsRead(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  refreshSettings: (...args: unknown[]) => mockRefreshSettings(...args),
}));

vi.mock("../agent/build-agent.js", () => ({
  resolveThreadId: vi.fn().mockReturnValue("thread-1"),
}));

vi.mock("../agent/run-execution.js", () => ({
  executeAgentRun: vi.fn().mockResolvedValue("agent result"),
}));

vi.mock("../utils/notify.js", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
  deliverRunResults: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/semaphore.js", () => ({
  runWithConcurrencyLimit: vi.fn((_max: number, fn: () => Promise<unknown>) => fn()),
}));

// cron-parser is a real dep — don't mock it. We want the actual prev()
// computation so the tests exercise the real due-detection logic.

// node-cron is only used for cron.validate() in the code under test.
// Use the real module so validate() returns true for standard expressions.

import {
  runCronTick,
  drainReminders,
  fireDueSchedules,
} from "../cron.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockClaimDueReminders.mockResolvedValue([]);
  mockGetEnabledSchedules.mockResolvedValue([]);
  mockClaimScheduleFire.mockResolvedValue(true);
});

// ── drainReminders ─────────────────────────────────────────────

describe("drainReminders()", () => {
  it("returns 0 when nothing is due", async () => {
    mockClaimDueReminders.mockResolvedValueOnce([]);
    const count = await drainReminders();
    expect(count).toBe(0);
    expect(mockCompleteReminder).not.toHaveBeenCalled();
    expect(mockAdvanceReminderByDate).not.toHaveBeenCalled();
  });

  it("completes one-shot reminders", async () => {
    mockClaimDueReminders.mockResolvedValueOnce([
      {
        id: "r1",
        source_type: "system",
        source_id: "reminder:r1",
        target_type: "inbox",
        target_id: null,
        summary: "Take out the trash",
        detail: {},
        priority: "normal",
        status: "sending",
        expires_at: null,
        scheduled_at: "2026-01-01T00:00:00Z",
        recurrence: null,
        targets: ["inbox"],
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const count = await drainReminders();
    expect(count).toBe(1);
    expect(mockCompleteReminder).toHaveBeenCalledWith("r1");
    expect(mockAdvanceReminderByInterval).not.toHaveBeenCalled();
  });

  it("advances recurring interval reminders", async () => {
    mockClaimDueReminders.mockResolvedValueOnce([
      {
        id: "r2",
        source_type: "system",
        source_id: "reminder:r2",
        target_type: "inbox",
        target_id: null,
        summary: "Stretch",
        detail: {},
        priority: "normal",
        status: "sending",
        expires_at: null,
        scheduled_at: "2026-01-01T00:00:00Z",
        recurrence: "1 hour",
        targets: ["inbox"],
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const count = await drainReminders();
    expect(count).toBe(1);
    expect(mockAdvanceReminderByInterval).toHaveBeenCalledWith("r2", "1 hour");
    expect(mockCompleteReminder).not.toHaveBeenCalled();
  });
});

// ── fireDueSchedules ───────────────────────────────────────────

describe("fireDueSchedules()", () => {
  it("returns 0 when no schedules exist", async () => {
    mockGetEnabledSchedules.mockResolvedValueOnce([]);
    const fired = await fireDueSchedules(new Date("2026-01-01T12:00:00Z"));
    expect(fired).toBe(0);
    expect(mockClaimScheduleFire).not.toHaveBeenCalled();
  });

  it("does NOT fire a schedule whose prev() equals last_fired_at", async () => {
    // Every-minute cron. At 12:00:30, prev() = 12:00:00. If last_fired_at
    // is also 12:00:00, we should skip.
    mockGetEnabledSchedules.mockResolvedValueOnce([
      {
        id: "s1",
        agent_id: "a1",
        agent_name: "edda",
        name: "every minute",
        cron: "* * * * *",
        prompt: "do the thing",
        thread_lifetime: null,
        notify: [],
        notify_expires_after: null,
        skip_when_empty_type: null,
        enabled: true,
        last_fired_at: "2026-01-01T12:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const fired = await fireDueSchedules(new Date("2026-01-01T12:00:30Z"));
    expect(fired).toBe(0);
    expect(mockClaimScheduleFire).not.toHaveBeenCalled();
  });

  it("fires a schedule whose prev() is newer than last_fired_at", async () => {
    // Every-minute cron. At 12:01:30, prev() = 12:01:00. last_fired_at
    // is 12:00:00. Should fire.
    mockGetEnabledSchedules.mockResolvedValueOnce([
      {
        id: "s1",
        agent_id: "a1",
        agent_name: "edda",
        name: "every minute",
        cron: "* * * * *",
        prompt: "do the thing",
        thread_lifetime: null,
        notify: [],
        notify_expires_after: null,
        skip_when_empty_type: null,
        enabled: true,
        last_fired_at: "2026-01-01T12:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mockGetScheduleById.mockResolvedValueOnce({
      id: "s1",
      agent_id: "a1",
      name: "every minute",
      cron: "* * * * *",
      prompt: "do the thing",
      thread_lifetime: null,
      notify: [],
      notify_expires_after: null,
      skip_when_empty_type: null,
      enabled: true,
      last_fired_at: "2026-01-01T12:01:00Z",
      created_at: "2026-01-01T00:00:00Z",
    });
    mockGetAgentByName.mockResolvedValueOnce({
      id: "a1",
      name: "edda",
      enabled: true,
      model: null,
      thread_lifetime: "persistent",
      metadata: {},
    });

    const fired = await fireDueSchedules(new Date("2026-01-01T12:01:30Z"));
    expect(fired).toBe(1);
    expect(mockClaimScheduleFire).toHaveBeenCalledWith("s1", expect.any(Date));
    expect(mockCreateTaskRun).toHaveBeenCalledOnce();
  });

  it("does NOT run when claimScheduleFire returns false (lost race)", async () => {
    // Same setup as above, but the CAS claim fails — another runner got
    // there first. Must not call getScheduleById or createTaskRun.
    mockGetEnabledSchedules.mockResolvedValueOnce([
      {
        id: "s1",
        agent_id: "a1",
        agent_name: "edda",
        name: "every minute",
        cron: "* * * * *",
        prompt: "do the thing",
        thread_lifetime: null,
        notify: [],
        notify_expires_after: null,
        skip_when_empty_type: null,
        enabled: true,
        last_fired_at: "2026-01-01T12:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mockClaimScheduleFire.mockResolvedValueOnce(false);

    // fireDueSchedules still counts this as "fired" from its own
    // perspective — the counter tracks "attempted to fire" not "actually
    // executed". The important assertion is that downstream work
    // (getScheduleById, createTaskRun) was skipped.
    const fired = await fireDueSchedules(new Date("2026-01-01T12:01:30Z"));
    expect(fired).toBe(1);
    expect(mockClaimScheduleFire).toHaveBeenCalledOnce();
    expect(mockGetScheduleById).not.toHaveBeenCalled();
    expect(mockCreateTaskRun).not.toHaveBeenCalled();
  });

  it("skips schedules with invalid cron expressions", async () => {
    mockGetEnabledSchedules.mockResolvedValueOnce([
      {
        id: "s1",
        agent_id: "a1",
        agent_name: "edda",
        name: "bad",
        cron: "not a cron",
        prompt: "x",
        thread_lifetime: null,
        notify: [],
        notify_expires_after: null,
        skip_when_empty_type: null,
        enabled: true,
        last_fired_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const fired = await fireDueSchedules(new Date("2026-01-01T12:00:00Z"));
    expect(fired).toBe(0);
    expect(mockClaimScheduleFire).not.toHaveBeenCalled();
  });
});

// ── runCronTick ────────────────────────────────────────────────

describe("runCronTick()", () => {
  it("returns both counts and a duration", async () => {
    const result = await runCronTick();
    expect(result).toMatchObject({
      remindersFired: 0,
      schedulesFired: 0,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("skipSchedules=true short-circuits fireDueSchedules", async () => {
    const result = await runCronTick({ skipSchedules: true });
    expect(result.schedulesFired).toBe(0);
    expect(mockGetEnabledSchedules).not.toHaveBeenCalled();
  });

  it("runs maintenance every tick", async () => {
    await runCronTick();
    expect(mockDeleteExpiredNotifications).toHaveBeenCalledOnce();
    expect(mockExpirePendingActions).toHaveBeenCalledOnce();
    expect(mockResetStuckSendingReminders).toHaveBeenCalledOnce();
  });
});
