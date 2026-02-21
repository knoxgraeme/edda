import { defineConfig } from "vitest/config";

const reporters = ["default"];
if (process.env.LANGSMITH_API_KEY) {
  reporters.push("langsmith/vitest/reporter");
}

export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    testTimeout: 60_000,
    reporters,
    setupFiles: ["dotenv/config"],
  },
});
