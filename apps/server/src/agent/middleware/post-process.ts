/**
 * EddaPostProcessMiddleware — afterAgent hook
 *
 * Runs after each conversation ends. Two jobs:
 * 1. Memory extraction — preferences, facts, patterns
 * 2. Entity extraction + linking — people, projects, companies
 *
 * Both happen in a single LLM call. Both go through semantic dedup
 * (pgvector cosine search) before writing.
 *
 * See cortex-spec-v4.md § EddaPostProcessMiddleware for full docs.
 */

// TODO: Implement — see spec for extraction prompt, dedup logic,
// threshold handling, and entity merge/alias flow.
export class EddaPostProcessMiddleware {
  name = "edda-post-process";

  async afterAgent(_state: unknown): Promise<unknown> {
    // Placeholder — implementation follows spec exactly
    return _state;
  }
}
