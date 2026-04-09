# Recommended Changes

Findings from a code-level audit of Edda's memory system, deepagents integration, and supporting infrastructure. Each recommendation references the specific file and line range where the issue lives.

---

## Priority 1: Data Integrity

### 1.1 Add dedup to `batch_create_items`

**Problem:** `create_item` deduplicates knowledge types (preference, learned_fact, pattern) at 0.95 cosine similarity. `batch_create_items` skips dedup entirely. The only backstop is `memory_maintenance` running weekly at 0.80 — a 7-day window where duplicates accumulate silently.

**Files:**
- `apps/server/src/agent/tools/create-item.ts:48-117` (has dedup)
- `apps/server/src/agent/tools/batch-create-items.ts` (no dedup)

**Options (pick one):**
1. **Post-batch dedup pass** — after batch insert, run a similarity query against the batch and merge hits. Adds latency but is correct.
2. **Content hash column** — add a `content_hash` (e.g. SHA-256 of normalized `type + content`) to the `items` table with a unique constraint for knowledge types. Use `INSERT ... ON CONFLICT (content_hash) DO UPDATE SET last_reinforced_at = now()`. Zero application-level dedup needed.
3. **Minimum viable** — filter DEDUP_TYPES out of batch calls and route them through `create_item` individually. Keep batch for non-knowledge types.

**Recommendation:** Option 2 (content hash). It also fixes the race condition in 1.2.

### 1.2 Fix dedup race condition in `create_item`

**Problem:** The dedup check is application-level: search → check → insert with no transaction boundary. Two concurrent requests creating the same preference both pass the search and both insert.

**File:** `apps/server/src/agent/tools/create-item.ts:97-117`

**When this matters:** The default `edda` agent is persistent-threaded. Concurrent channel messages (Telegram + Discord + web UI) can trigger parallel tool calls creating the same knowledge.

**Fix:** If you add a content hash (1.1 option 2), this is automatically resolved by the `ON CONFLICT` clause. Otherwise, wrap the search+insert in a serializable transaction or use advisory locking on the content hash.

### 1.3 Handle embedding model migration

**Problem:** Switching embedding provider/model in settings (e.g. Voyage → OpenAI) silently poisons search quality. Old vectors stay in the `items` table with the previous model's geometry. Mixed-model cosine similarity produces meaningless scores. No warning, no re-embedding, no dimensional check.

**Files:**
- `apps/server/src/embed.ts:12-46` (cache invalidation works, but no migration)
- `packages/db/src/items.ts` (searches across all embeddings regardless of model)

**Fix (phased):**
1. **Immediate:** Log a warning when `embedding_model` on retrieved items doesn't match current model. Surface this in the web UI settings page.
2. **Short-term:** Add a `re-embed` management command/API endpoint that re-embeds all items with the current provider. Run it after any provider change.
3. **Long-term:** On settings change, automatically queue a background re-embedding job. Filter search to `embedding_model = current_model` until re-embedding completes (with fallback to cross-model results if no matches).

---

## Priority 2: Search Quality

### 2.1 Unify dedup thresholds

**Problem:** The `capture` skill instructs the agent to search at 0.85 before creating. Then `create_item` searches again at 0.95. This double-search is wasteful, and the 0.85–0.95 gap creates a confusing zone where capture skips creation but `create_item` wouldn't have caught the duplicate anyway.

**Files:**
- `apps/server/skills/capture/SKILL.md:166` (0.85 threshold)
- `apps/server/src/agent/tools/create-item.ts:101` (0.95 threshold)

**Fix:** Pick a single threshold (~0.90) and apply it in `create_item`. Remove the capture skill's "search before creating" instruction — let the tool handle dedup consistently. The capture skill should focus on _what_ to extract, not _how_ to deduplicate.

### 2.2 Add memory pressure signals

**Problem:** No mechanism tells an agent or user "you have too many active items." A power user can accumulate thousands of active items within 90 days (before `memory_maintenance` archives them), degrading search quality through noise.

**Fix:**
1. Add a `memory_stats` tool (or extend `list_item_types`) that returns active item count by type, average age, and search hit rate.
2. In `memory_maintenance`, add a step: if active items > configurable threshold (e.g. 5000), aggressively archive low-reinforcement items beyond the most recent N per type.
3. Surface a dashboard metric in the web UI: "Active memories: X" with a health indicator.

---

## Priority 3: Deepagents Integration

### 3.1 Use `/store/` more actively as working memory

**Problem:** The `/store/` mount gives agents persistent cross-thread file storage, but it's mostly used for final output (`/store/latest`). Daily-threaded agents lose all working context the next day. The cross-agent store mounting (`metadata.stores`) is powerful but under-documented in agent prompts.

**Files:**
- `apps/server/src/agent/build-agent.ts:292-294` (store mentioned in system prompt)
- `apps/server/src/agent/backends.ts:153-203` (cross-agent mount setup)

**Fix:**
1. Update agent system prompts (or the system context layer) to explicitly guide agents on store usage patterns: `/store/scratchpad` for working notes, `/store/YYYY-MM-DD` for daily summaries, `/store/latest` for most recent output.
2. For `digest` agent (daily-threaded): instruct it to write a daily summary to `/store/YYYY-MM-DD` so cross-agent readers can access historical digests even after thread expiry.
3. Document `metadata.stores` patterns in the admin/agent-creation skill so user-created agents get meaningful cross-agent access by default.

### 3.2 Consider lazy subagent resolution

**Problem:** `resolveSubagents()` fetches all subagent DB rows, loads skills, builds prompts, and resolves models at parent agent build time. For agents with many subagents, this adds startup latency even if those subagents are never invoked in a given run.

**File:** `apps/server/src/agent/build-agent.ts:175-231`

**Fix:** If deepagents supports lazy subagent construction (build on first `task` call), adopt it. Otherwise, consider caching resolved SubagentSpecs and invalidating on agent config change, rather than re-resolving on every `buildAgent()` call.

### 3.3 Clean up the backend factory workaround

**Problem:** `buildBackend()` returns a closure that returns a `CompositeBackend` factory because deepagents expects a synchronous factory but Edda needs async DB lookups. The comment says "closes over store for SkillsMiddleware compatibility."

**File:** `apps/server/src/agent/backends.ts:101-118`

**Fix:** If you have influence over deepagents, request support for async backend factories. This would eliminate the closure indirection and make the backend setup more readable. Low priority — the workaround is functional.

---

## Priority 4: Operational Resilience

### 4.1 Add superseded item cleanup

**Problem:** Superseded items (`superseded_by IS NOT NULL`) remain in the database and pgvector index indefinitely. They're excluded from search by default, but still consume index space and slow IVFFLAT scans.

**Files:**
- `packages/db/src/items.ts:137-139` (excludeSuperseded filter)
- `apps/server/skills/memory-maintenance/SKILL.md:48-49` (sets superseded_by but doesn't clean up)

**Fix:** In `memory_maintenance`, add a step: hard-delete (or move to an archive table) items where `superseded_by IS NOT NULL AND updated_at < now() - interval '30 days'`. These have been replaced and aged out — keeping them provides no value.

### 4.2 Add embedding dimension validation

**Problem:** The `items.embedding` column is `vector(1024)`. If a user switches to a provider with different default dimensions (e.g. OpenAI text-embedding-3-large at 3072), inserts will fail with a pgvector dimension mismatch error, but the error message won't be user-friendly.

**Files:**
- `packages/db/migrations/001_initial.sql` (vector(1024) column)
- `apps/server/src/embed.ts` (no dimension check)

**Fix:** In `embed.ts`, after creating the embeddings instance, validate that the output dimension matches `settings.embedding_dimensions`. If mismatched, throw a descriptive error at startup rather than failing on first insert.

---

## Summary

| # | Change | Severity | Effort | Risk if Skipped |
|---|--------|----------|--------|-----------------|
| 1.1 | Batch dedup | High | Medium | Silent duplicate accumulation |
| 1.2 | Dedup race condition | High | Low (if 1.1 uses content hash) | Concurrent duplicate creation |
| 1.3 | Embedding migration | High | Medium | Silent search quality degradation |
| 2.1 | Unify thresholds | Medium | Low | Wasted compute, confusing behavior |
| 2.2 | Memory pressure | Medium | Medium | Unbounded item growth degrades search |
| 3.1 | Store usage patterns | Low | Low | Under-utilized cross-agent feature |
| 3.2 | Lazy subagent resolution | Low | Medium | Unnecessary startup latency |
| 3.3 | Backend factory cleanup | Low | Low | Code clarity only |
| 4.1 | Superseded cleanup | Low | Low | Index bloat over time |
| 4.2 | Dimension validation | Low | Low | Confusing errors on provider switch |
