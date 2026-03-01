import { describe, expect, it } from "vitest";
import { buildSlackExternalId } from "../channels/slack.js";

describe("buildSlackExternalId", () => {
  it("prefers event team id when present", () => {
    expect(buildSlackExternalId("C123", "T999", "T111")).toBe("T999:C123");
  });

  it("falls back to default team id when event team id is missing", () => {
    expect(buildSlackExternalId("C123", undefined, "T111")).toBe("T111:C123");
  });

  it("falls back to workspace prefix when no team id is available", () => {
    expect(buildSlackExternalId("C123")).toBe("workspace:C123");
  });
});
