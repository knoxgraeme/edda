---
name: memory_triage
description: >
  Post-conversation hotpatch check for memory files. Runs in the afterAgent
  post-process hook. Compares conversation content against existing memory files
  for mentioned entities. If a contradiction or significant new info is detected,
  makes a lightweight LLM call to update the brief in-place via store.put().
---

# memory_triage

## Trigger
AfterAgent hook (post-process middleware), after maybeRefreshAgentsMd().

## Behavior
1. Extract entity mentions from conversation via embedding similarity search.
2. For each mentioned entity, check if a memory file exists in PostgresStore.
3. For entities with memory files, compare conversation content against the brief.
4. Decision:
   - **Contradiction** → hotpatch (e.g., "Sarah switched to NewCo" when brief says OldCo)
   - **Significant new info** → hotpatch (e.g., new project role, major life event)
   - **Minor/reinforcement** → skip (existing brief is still accurate)
5. If hotpatching: lightweight LLM call using settings.memory_sync_model to edit
   the brief, then store.put() with source='hotpatch'.

## Cost
Uses settings.memory_sync_model. Only triggers LLM call when entities with memory
files are mentioned. In most conversations this is a no-op (embedding search + store
lookup only). When it fires, cost is minimal — one structured output call.
