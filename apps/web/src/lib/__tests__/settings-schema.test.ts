import { describe, it, expect } from "vitest";
import { UpdateSettingsSchema } from "../settings-schema";

describe("UpdateSettingsSchema", () => {
  it("accepts all 21 editable fields in a single payload", () => {
    const payload = {
      user_display_name: "Knox",
      user_timezone: "America/New_York",
      llm_provider: "anthropic",
      default_model: "claude-sonnet-4-6",
      embedding_provider: "voyage",
      embedding_model: "voyage-3.5-lite",
      embedding_dimensions: 1024,
      search_provider: "brave",
      web_search_max_results: 5,
      default_agent: "edda",
      task_max_concurrency: 3,
      cron_runner: "local",
      sandbox_provider: "node-vfs",
      approval_new_type: "confirm",
      approval_new_entity: "auto",
      approval_archive_stale: "confirm",
      approval_merge_entity: "auto",
      agents_md_token_budget: 4000,
      agents_md_max_per_category: 50,
      agents_md_max_versions: 30,
      agents_md_max_entities: 100,
      system_prompt_override: "extra context",
    };
    const parsed = UpdateSettingsSchema.parse(payload);
    // Every input key must survive .strip()
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(payload).sort());
  });

  it("accepts user_display_name: null", () => {
    const parsed = UpdateSettingsSchema.parse({ user_display_name: null });
    expect(parsed.user_display_name).toBeNull();
  });

  it("accepts system_prompt_override: null", () => {
    const parsed = UpdateSettingsSchema.parse({ system_prompt_override: null });
    expect(parsed.system_prompt_override).toBeNull();
  });

  it("rejects invalid timezone", () => {
    expect(() => UpdateSettingsSchema.parse({ user_timezone: "Not/A/Zone" })).toThrow();
  });

  it("rejects unknown llm_provider", () => {
    expect(() => UpdateSettingsSchema.parse({ llm_provider: "made_up" })).toThrow();
  });

  it("rejects agents_md_token_budget below 1", () => {
    expect(() => UpdateSettingsSchema.parse({ agents_md_token_budget: 0 })).toThrow();
  });

  it("strips unknown fields silently", () => {
    const parsed = UpdateSettingsSchema.parse({
      user_display_name: "x",
      unknown_field: "should be dropped",
    });
    expect(parsed).not.toHaveProperty("unknown_field");
  });
});
