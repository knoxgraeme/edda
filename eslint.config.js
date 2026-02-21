import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "apps/server/src/llm/index.ts",
      "apps/server/src/embed/index.ts",
      "apps/server/src/search/index.ts",
      "apps/server/src/checkpointer/index.ts",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
