import { z } from "zod";

/**
 * Transport-specific config schemas for MCP connections.
 * Validates config structure at the API boundary before DB write.
 */

const StdioConfigSchema = z
  .object({
    command: z.string().min(1).max(200),
    args: z.array(z.string().max(500)).max(20).default([]),
    env: z.record(z.string().max(1000)).optional(),
  })
  .strict();

const UrlConfigSchema = z
  .object({
    url: z.string().url().max(2000),
    auth_env_var: z
      .string()
      .regex(/^MCP_AUTH_[A-Z0-9_]+$/, 'auth_env_var must match pattern MCP_AUTH_<NAME>')
      .optional(),
  })
  .strict();

const CONFIG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  stdio: StdioConfigSchema,
  sse: UrlConfigSchema,
  "streamable-http": UrlConfigSchema,
};

/**
 * Validate that `config` matches the expected shape for `transport`.
 * Returns a Zod-style error string on failure, or null on success.
 * On success, `config` is replaced with the parsed (and stripped) value.
 */
export function validateMcpConfig(
  transport: string,
  config: unknown,
): { config: Record<string, unknown> } | { error: string } {
  const schema = CONFIG_SCHEMAS[transport];
  if (!schema) return { error: `Unknown transport: ${transport}` };

  const result = schema.safeParse(config);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? `config.${issue.path.join(".")}` : "config";
    return { error: `${path}: ${issue.message}` };
  }

  return { config: result.data as Record<string, unknown> };
}
