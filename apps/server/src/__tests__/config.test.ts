/**
 * Config loader tests — Zod validation of env vars, defaults, cache reset.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfig } from "../config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    // Shallow clone to allow mutation without polluting real env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it("valid env passes Zod validation", () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/edda";
    const config = loadConfig();
    expect(config.DATABASE_URL).toBe("postgresql://localhost:5432/edda");
  });

  it("missing DATABASE_URL throws descriptive error", () => {
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow("Environment validation failed");
    expect(() => {
      resetConfig();
      loadConfig();
    }).toThrow("DATABASE_URL");
  });

  it("optional vars use correct defaults", () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/edda";
    const config = loadConfig();
    expect(config.PORT).toBe(8000);
    // Vitest sets NODE_ENV=test, so default won't be "development" in test runner
    expect(config.NODE_ENV).toBe("test");
  });

  it("resetConfig() clears cached config", () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/edda";
    const first = loadConfig();
    expect(first.PORT).toBe(8000);

    resetConfig();
    process.env.PORT = "9999";
    const second = loadConfig();
    expect(second.PORT).toBe(9999);
  });
});
