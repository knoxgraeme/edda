---
status: pending
priority: p1
issue_id: "042"
tags: [code-review, security, typescript]
dependencies: []
---

# MCP Tool Schema Bypass — z.record(z.unknown()) for All Dynamic Tools

## Problem Statement
Dynamically loaded MCP tools all get `schema: z.record(z.unknown())`, meaning the LLM has zero structured type guidance for input parameters. The MCP server provides `inputSchema` (JSON Schema) per tool, but it's only included in the description text, not enforced at the Zod validation layer. Combined with unsafe `as string` casts on MCP connection config, this creates both a type safety and prompt injection risk.

## Findings
- **mcp.ts line 126:** `schema: z.record(z.unknown())` on all DynamicStructuredTools
- **mcp.ts lines 27-34:** Multiple `as string`, `as string[]` casts on config without validation
- MCP server's `inputSchema` is available but unused for validation
- If LLM is manipulated via prompt injection in stored content, it could invoke MCP tools with unexpected inputs
- Agents: Security Sentinel (F3), TypeScript Reviewer (#4, #5)

## Proposed Solutions

### Option A: Convert JSON Schema to Zod at Load Time (Recommended)
Use a library like `json-schema-to-zod` to convert MCP `inputSchema` to Zod schemas.
- **Pros:** Full validation, proper LLM guidance
- **Effort:** Medium
- **Risk:** Low

### Option B: Validate Required Properties Only
Parse `inputSchema` for `required` array and validate those keys exist.
- **Pros:** Simple, partial coverage
- **Effort:** Small
- **Risk:** Medium — only validates presence, not types

### Option C: Zod Schema for MCP Config (Quick Win)
At minimum, add discriminated union Zod schemas for stdio/SSE/HTTP config.
- **Pros:** Fixes the `as string` casts immediately
- **Effort:** Small
- **Risk:** Low

## Technical Details
- **Affected files:** `apps/server/src/agent/mcp.ts`

## Acceptance Criteria
- [ ] MCP tools have validated input schemas (not z.record(z.unknown()))
- [ ] MCP connection config uses Zod validation instead of `as string` casts
- [ ] Required MCP tool parameters are enforced

## Work Log
| Date | Action | Notes |
|------|--------|-------|
| 2026-02-20 | Created | Found by Security Sentinel, TypeScript Reviewer |

## Resources
- PR #1
