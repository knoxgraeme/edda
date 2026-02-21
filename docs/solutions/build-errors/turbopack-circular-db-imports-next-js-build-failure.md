---
title: "Circular Dependency in @edda/db Barrel Exports Broke Next.js Turbopack Build"
date: 2026-02-20
category: build-errors
tags:
  - circular-dependencies
  - next.js
  - turbopack
  - module-resolution
  - monorepo
  - barrel-exports
severity: critical
component: "@edda/db (packages/db/src)"
symptoms:
  - "Turbopack build failure in CI with 'export not found' errors"
  - "tsc passed locally but Next.js build failed on CI"
  - "Error: The export updateItem was not found in module @edda/db"
  - "Error: The export updateSettings was not found in module @edda/db"
root_cause: "Query modules imported getPool from ./index.ts which re-exported those same modules via `export *`, creating a circular dependency that Turbopack could not resolve"
resolution: "Extracted getPool/closePool into dedicated connection.ts; updated all query modules to import from ./connection.js"
time_to_resolve: "~30 minutes"
recurrence_risk: medium
---

# Circular Dependency in @edda/db Broke Next.js Turbopack Build

## Problem

After adding Dashboard, Inbox, and Settings pages that imported query functions from `@edda/db`, the CI build failed with:

```
The export updateItem was not found in module [project]/packages/db/src/index.ts [app-rsc]
The export updateSettings was not found in module [project]/packages/db/src/index.ts [app-rsc]
All exports of the module are statically known (It doesn't have dynamic exports).
So it's known statically that the requested export doesn't exist.
```

**Key confusion**: `pnpm type-check` passed locally. `pnpm lint` passed. `pnpm test` passed. Only `pnpm build` (which triggers Next.js Turbopack) failed, and only on CI.

## Investigation

1. Confirmed `updateItem` and `updateSettings` existed in `packages/db/src/items.ts` and `settings.ts`
2. Confirmed `index.ts` re-exported them via `export * from "./items.js"` and `export * from "./settings.js"`
3. Noticed all query modules imported `getPool` from `./index.js` — the same file that re-exported them
4. Identified the circular dependency: `index.ts` → `items.ts` → `index.ts`

## Root Cause

TypeScript and Turbopack handle circular `export *` differently:

**TypeScript (`tsc`)**: Uses semantic analysis. It resolves the full module graph before determining exports, tolerating circular references because it evaluates types holistically.

**Turbopack**: Uses strict static module analysis. When it encounters `export * from "./items.js"` in `index.ts`, it tries to statically resolve what `items.ts` exports. But `items.ts` imports from `./index.js` (still being analyzed), creating an unresolvable loop. The static analyzer cannot determine what to re-export, so it marks exports as "not found."

```
index.ts:
  export * from "./items.js"    ← Turbopack tries to resolve
  export function getPool()...  ← Defined here

items.ts:
  import { getPool } from "./index.js"  ← Imports back from index!
  export async function updateItem()... ← Turbopack can't see this

Result: Circular dependency → export resolution fails
```

## Solution

### Step 1: Extract connection pool into dedicated module

Created `packages/db/src/connection.ts` with `getPool()` and `closePool()` — a leaf module with no imports from the package's own modules:

```typescript
// packages/db/src/connection.ts
import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
```

### Step 2: Update index.ts to be a pure re-export aggregator

```typescript
// packages/db/src/index.ts — AFTER (no runtime code)
export * from "./connection.js";
export * from "./types.js";
export * from "./items.js";
export * from "./entities.js";
// ... other re-exports
```

### Step 3: Update all query modules

Changed 9 files from `import { getPool } from "./index.js"` to `import { getPool } from "./connection.js"`:

- `items.ts`, `entities.ts`, `settings.ts`, `item-types.ts`, `dashboard.ts`, `mcp-connections.ts`, `agent-log.ts`, `threads.ts`, `confirmations.ts`

### Result: Acyclic dependency graph

```
connection.ts  (leaf — no internal imports)
    ↑
query modules  (import from connection.ts, not index.ts)
    ↑
index.ts       (pure re-export aggregator)
```

## Verification

- `pnpm type-check` — all 5 packages pass
- `pnpm lint` — 0 errors
- `pnpm build` — Next.js Turbopack resolves all exports
- Public API unchanged — consumers still `import { updateItem } from "@edda/db"`

## Prevention Strategies

### 1. Keep barrel files as pure re-export aggregators

Never define runtime code (factories, pools, state) in a file that also uses `export *`:

```typescript
// ✗ WRONG: index.ts has runtime code AND re-exports
export function getPool(): Pool { ... }
export * from "./items.js";  // items.ts imports getPool from here → cycle

// ✓ CORRECT: index.ts is pure re-exports only
export * from "./connection.js";
export * from "./items.js";
```

### 2. Internal modules import from specific files, not the barrel

```typescript
// ✗ WRONG: creates cycle risk
import { getPool } from "./index.js";

// ✓ CORRECT: imports from leaf module
import { getPool } from "./connection.js";
```

### 3. Detect circular imports with tooling

**madge** (circular dependency detector):
```bash
npx madge --circular --extensions ts src/
```

**eslint-plugin-import**:
```json
{ "import/no-cycle": ["error", { "maxDepth": "∞" }] }
```

### 4. Test the Next.js build locally before pushing

```bash
cd apps/web && npx next build
```

`tsc` passing does NOT guarantee the bundler can resolve your exports.

## Related

- Commit: `be11ab8` — fix(db): break circular imports to fix Next.js build
- Commit: `8acf843` — feat(web): add Dashboard, Inbox, and Settings pages (triggered the issue)
- CLAUDE.md architecture rules: client components must not import `@edda/db` directly
