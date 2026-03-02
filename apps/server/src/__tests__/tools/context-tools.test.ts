/**
 * Tool invocation tests — save_agents_md and get_agents_md tools.
 *
 * Verifies save_agents_md saves version and prunes.
 * Verifies get_agents_md returns current content and token budget.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetSettingsSync,
  mockSaveAgentsMdVersion,
  mockPruneAgentsMdVersions,
  mockGetLatestAgentsMd,
} = vi.hoisted(() => ({
  mockGetSettingsSync: vi.fn(),
  mockSaveAgentsMdVersion: vi.fn().mockResolvedValue(undefined),
  mockPruneAgentsMdVersions: vi.fn().mockResolvedValue(undefined),
  mockGetLatestAgentsMd: vi.fn().mockResolvedValue(null),
}));

vi.mock("@edda/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSettingsSync: mockGetSettingsSync,
    saveAgentsMdVersion: mockSaveAgentsMdVersion,
    pruneAgentsMdVersions: mockPruneAgentsMdVersions,
    getLatestAgentsMd: mockGetLatestAgentsMd,
  };
});

import { saveAgentsMdTool } from "../../agent/tools/save-agents-md.js";
import { getAgentsMdTool } from "../../agent/tools/get-agents-md.js";

const DEFAULT_SETTINGS = {
  agents_md_token_budget: 4000,
  agents_md_max_versions: 3,
};

/** Config with agent_name in configurable, matching how LangGraph invokes tools. */
const agentConfig = (name: string) => ({
  configurable: { agent_name: name },
});

// ── Tests ──────────────────────────────────────────────────────

describe("save_agents_md tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_SETTINGS);
  });

  it("saves content and prunes old versions", async () => {
    const result = await saveAgentsMdTool.invoke(
      { content: "# My AGENTS.md" },
      agentConfig("edda"),
    );
    const parsed = JSON.parse(result);

    expect(parsed.saved).toBe(true);
    expect(parsed.length).toBe(14);

    expect(mockSaveAgentsMdVersion).toHaveBeenCalledOnce();
    const call = mockSaveAgentsMdVersion.mock.calls[0][0];
    expect(call.content).toBe("# My AGENTS.md");
    expect(call.agentName).toBe("edda");

    expect(mockPruneAgentsMdVersions).toHaveBeenCalledWith(3);
  });

  it("passes the calling agent name to saveAgentsMdVersion", async () => {
    await saveAgentsMdTool.invoke(
      { content: "content" },
      agentConfig("maintenance"),
    );
    const call = mockSaveAgentsMdVersion.mock.calls[0][0];
    expect(call.agentName).toBe("maintenance");
  });

  it("uses max_versions from settings for pruning", async () => {
    mockGetSettingsSync.mockReturnValue({ ...DEFAULT_SETTINGS, agents_md_max_versions: 10 });
    await saveAgentsMdTool.invoke({ content: "content" }, agentConfig("edda"));
    expect(mockPruneAgentsMdVersions).toHaveBeenCalledWith(10);
  });

  it("throws when agent_name is missing from config", async () => {
    await expect(saveAgentsMdTool.invoke({ content: "content" })).rejects.toThrow(
      "agent_name required in configurable",
    );
  });
});

describe("get_agents_md tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsSync.mockReturnValue(DEFAULT_SETTINGS);
  });

  it("returns content and token budget when version exists", async () => {
    mockGetLatestAgentsMd.mockResolvedValue({
      content: "existing content",
      agent_name: "edda",
    });

    const result = await getAgentsMdTool.invoke({}, agentConfig("edda"));
    const parsed = JSON.parse(result);
    expect(parsed.content).toBe("existing content");
    expect(parsed.token_budget).toBe(4000);
  });

  it("returns placeholder when no version exists", async () => {
    mockGetLatestAgentsMd.mockResolvedValue(null);

    const result = await getAgentsMdTool.invoke({}, agentConfig("edda"));
    const parsed = JSON.parse(result);
    expect(parsed.content).toBe("(empty — no operating notes yet)");
    expect(parsed.token_budget).toBe(4000);
  });

  it("passes agent name to getLatestAgentsMd", async () => {
    mockGetLatestAgentsMd.mockResolvedValue(null);

    await getAgentsMdTool.invoke({}, agentConfig("maintenance"));
    expect(mockGetLatestAgentsMd).toHaveBeenCalledWith("maintenance");
  });

  it("throws when agent_name is missing from config", async () => {
    await expect(getAgentsMdTool.invoke({})).rejects.toThrow(
      "agent_name required in configurable",
    );
  });
});
