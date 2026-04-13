/**
 * Minimal HTTP client for the Edda backend server (port 8000).
 *
 * The CLI prefers direct `@edda/db` access for reads. This client is
 * used only for operations that require the live backend — primarily
 * semantic search, which needs the embedding pipeline in
 * `apps/server/src/embed.ts`.
 *
 * Auth: reads `INTERNAL_API_SECRET` + `SERVER_URL` from process.env
 * (which is populated by `loadEnv()`).
 */

import { loadEnv } from "./load-env.js";

export interface BackendConfig {
  url: string;
  secret: string | null;
}

async function resolveConfig(override?: Partial<BackendConfig>): Promise<BackendConfig> {
  await loadEnv();
  const url = override?.url ?? process.env.SERVER_URL ?? "http://localhost:8000";
  const secret = override?.secret ?? process.env.INTERNAL_API_SECRET ?? null;
  return { url: url.replace(/\/$/, ""), secret };
}

export class BackendError extends Error {
  constructor(
    message: string,
    public status?: number,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** POST JSON to a backend endpoint and return the decoded JSON response. */
export async function backendPost<T = unknown>(
  path: string,
  body: unknown,
  override?: Partial<BackendConfig>,
): Promise<T> {
  const config = await resolveConfig(override);
  const url = `${config.url}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (/ECONNREFUSED|fetch failed/i.test(msg)) {
      throw new BackendError(
        `Could not reach the Edda server at ${config.url}. Is it running? Try \`pnpm dev\` in another terminal.`,
        undefined,
        err,
      );
    }
    throw new BackendError(`Network error talking to ${url}: ${msg}`, undefined, err);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new BackendError(
        `Authentication failed at ${url}. Check INTERNAL_API_SECRET in your .env.`,
        response.status,
      );
    }
    const text = await response.text().catch(() => "");
    throw new BackendError(
      `HTTP ${response.status} from ${url}${text ? `: ${text.slice(0, 200)}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
