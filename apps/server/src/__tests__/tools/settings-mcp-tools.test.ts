/**
 * Tool invocation tests — Settings and MCP connection tools.
 *
 * Verifies correct delegation to @edda/db functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { DEFAULT_SETTINGS } = vi.hoisted(() => ({
  DEFAULT_SETTINGS: {
    user_display_name: null,
    user_timezone: "America/New_York",
    web_search_enabled: false,
    web_search_max_results: 5,
    memory_extraction_enabled: true,
    user_crons_enabled: false,
    approval_new_type: "confirm",
    approval_archive_stale: "confirm",
    approval_merge_entity: "confirm",
    agents_md_token_budget: 1500,
    agents_md_max_per_category: 10,
    agents_md_max_versions: 3,
    agents_md_max_entities: 10,
    llm_provider: "anthropic",
    embedding_model: "voyage-3",
  },
}));

vi.mock("@edda/db", () => ({
  getSettingsSync: vi.fn().mockReturnValue(DEFAULT_SETTINGS),
  updateSettings: vi.fn(),
  createMcpConnection: vi.fn(),
  getMcpConnections: vi.fn().mockResolvedValue([]),
  updateMcpConnection: vi.fn(),
  deleteMcpConnection: vi.fn(),
}));

import {
  getSettingsSync,
  updateSettings,
  createMcpConnection,
  getMcpConnections,
  updateMcpConnection,
  deleteMcpConnection,
} from "@edda/db";

import { getSettingsTool } from "../../agent/tools/get-settings.js";
import { updateSettingsTool } from "../../agent/tools/update-settings.js";
import { addMcpConnectionTool } from "../../agent/tools/add-mcp-connection.js";
import { listMcpConnectionsTool } from "../../agent/tools/list-mcp-connections.js";
import { updateMcpConnectionTool } from "../../agent/tools/update-mcp-connection.js";
import { removeMcpConnectionTool } from "../../agent/tools/remove-mcp-connection.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSettingsTool", () => {
  it("calls getSettingsSync and filters to agent-visible keys", async () => {
    const result = await getSettingsTool.invoke({});
    const parsed = JSON.parse(result);

    expect(vi.mocked(getSettingsSync)).toHaveBeenCalled();
    // Should include agent-visible keys
    expect(parsed).toHaveProperty("user_timezone");
    expect(parsed).toHaveProperty("web_search_enabled");
    // Should NOT include infrastructure keys
    expect(parsed).not.toHaveProperty("llm_provider");
    expect(parsed).not.toHaveProperty("embedding_model");
  });
});

describe("updateSettingsTool", () => {
  it("calls updateSettings with validated fields", async () => {
    vi.mocked(updateSettings).mockResolvedValueOnce(undefined as never);

    const result = await updateSettingsTool.invoke({
      updates: { user_display_name: "Test User", web_search_enabled: true },
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(updateSettings)).toHaveBeenCalledWith(
      expect.objectContaining({
        user_display_name: "Test User",
        web_search_enabled: true,
      }),
    );
    expect(parsed.status).toBe("updated");
    expect(parsed.updated_keys).toContain("user_display_name");
    expect(parsed.updated_keys).toContain("web_search_enabled");
  });
});

describe("addMcpConnectionTool", () => {
  it("calls createMcpConnection with SSE transport", async () => {
    vi.mocked(createMcpConnection).mockResolvedValueOnce({
      id: "mcp-1",
      name: "TestMCP",
    } as never);

    const result = await addMcpConnectionTool.invoke({
      name: "TestMCP",
      url: "https://mcp.example.com/sse",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(createMcpConnection)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "TestMCP",
        transport: "sse",
        config: expect.objectContaining({ url: "https://mcp.example.com/sse" }),
      }),
    );
    expect(parsed.status).toBe("created");
    expect(parsed.id).toBe("mcp-1");
  });
});

describe("listMcpConnectionsTool", () => {
  it("calls getMcpConnections", async () => {
    vi.mocked(getMcpConnections).mockResolvedValueOnce([
      { id: "mcp-1", name: "Test" },
    ] as never);

    const result = await listMcpConnectionsTool.invoke({});
    const parsed = JSON.parse(result);

    expect(vi.mocked(getMcpConnections)).toHaveBeenCalled();
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("mcp-1");
  });
});

describe("updateMcpConnectionTool", () => {
  it("calls updateMcpConnection with updates", async () => {
    vi.mocked(updateMcpConnection).mockResolvedValueOnce({
      id: "mcp-1",
      name: "Renamed",
      enabled: false,
    } as never);

    const result = await updateMcpConnectionTool.invoke({
      id: "mcp-1",
      enabled: false,
      name: "Renamed",
    });
    const parsed = JSON.parse(result);

    expect(vi.mocked(updateMcpConnection)).toHaveBeenCalledWith("mcp-1", {
      enabled: false,
      name: "Renamed",
    });
    expect(parsed.status).toBe("updated");
  });

  it("returns not_found when connection missing", async () => {
    vi.mocked(updateMcpConnection).mockResolvedValueOnce(null as never);

    const result = await updateMcpConnectionTool.invoke({ id: "mcp-missing" });
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe("not_found");
  });
});

describe("removeMcpConnectionTool", () => {
  it("calls deleteMcpConnection with ID", async () => {
    vi.mocked(deleteMcpConnection).mockResolvedValueOnce(undefined as never);

    const result = await removeMcpConnectionTool.invoke({ id: "mcp-1" });
    const parsed = JSON.parse(result);

    expect(vi.mocked(deleteMcpConnection)).toHaveBeenCalledWith("mcp-1");
    expect(parsed.status).toBe("removed");
    expect(parsed.id).toBe("mcp-1");
  });
});
