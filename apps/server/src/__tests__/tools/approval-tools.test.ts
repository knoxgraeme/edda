/**
 * Tool invocation tests — Approval tools (confirm/reject pending).
 *
 * Verifies correct delegation to @edda/db confirmation functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@edda/db", () => ({
  confirmPending: vi.fn(),
  rejectPending: vi.fn(),
  getItemById: vi.fn(),
  updateItem: vi.fn(),
}));

import { confirmPending, rejectPending, getItemById, updateItem } from "@edda/db";

import { confirmPendingTool } from "../../agent/tools/confirm-pending.js";
import { rejectPendingTool } from "../../agent/tools/reject-pending.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("confirmPendingTool", () => {
  it("calls confirmPending with table and id", async () => {
    vi.mocked(confirmPending).mockResolvedValueOnce(undefined as never);

    const result = await confirmPendingTool.invoke({ table: "items", id: "item-1" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(confirmPending)).toHaveBeenCalledWith("items", "item-1");
    expect(parsed.status).toBe("confirmed");
    expect(parsed.table).toBe("items");
    expect(parsed.id).toBe("item-1");
  });

  it("works with item_types table", async () => {
    vi.mocked(confirmPending).mockResolvedValueOnce(undefined as never);

    const result = await confirmPendingTool.invoke({
      table: "item_types",
      id: "custom_type",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(confirmPending)).toHaveBeenCalledWith("item_types", "custom_type");
    expect(parsed.status).toBe("confirmed");
  });
});

describe("rejectPendingTool", () => {
  it("calls rejectPending for a simple item rejection", async () => {
    vi.mocked(getItemById).mockResolvedValueOnce({
      id: "item-1",
      pending_action: "new",
      metadata: {},
    } as never);
    vi.mocked(rejectPending).mockResolvedValueOnce(undefined as never);

    const result = await rejectPendingTool.invoke({ id: "item-1", table: "items" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(rejectPending)).toHaveBeenCalledWith("items", "item-1");
    expect(parsed.status).toBe("rejected");
  });

  it("reverts reclassification to previous type", async () => {
    vi.mocked(getItemById).mockResolvedValueOnce({
      id: "item-2",
      pending_action: "reclassify",
      metadata: { previous_type: "note" },
    } as never);
    vi.mocked(updateItem).mockResolvedValueOnce({ id: "item-2" } as never);

    const result = await rejectPendingTool.invoke({ id: "item-2", table: "items" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(updateItem)).toHaveBeenCalledWith(
      "item-2",
      expect.objectContaining({
        type: "note",
        confirmed: true,
        pending_action: null,
      }),
    );
    expect(parsed.status).toBe("reverted");
    expect(parsed.reverted_to_type).toBe("note");
  });

  it("delegates to rejectPending for non-items tables", async () => {
    vi.mocked(rejectPending).mockResolvedValueOnce(undefined as never);

    const result = await rejectPendingTool.invoke({ id: "ent-1", table: "entities" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(rejectPending)).toHaveBeenCalledWith("entities", "ent-1");
    expect(parsed.status).toBe("rejected");
    expect(parsed.table).toBe("entities");
  });
});
