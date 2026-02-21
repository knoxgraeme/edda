---
status: complete
priority: p2
issue_id: "027"
tags: [code-review, security, xss]
dependencies: []
---

# Problem Statement
`MarkdownContent.tsx` uses a custom `a` component renderer that passes `href` directly to `<a>` without sanitising the protocol. `react-markdown`'s default sanitisation pipeline is bypassed by custom renderers. Since the AI assistant generates markdown from user-stored content (items, memories, entities), a stored `javascript:` URI in any captured text could execute on click when echoed back by the agent.

The path: user stores content → agent echoes as markdown link → user clicks → XSS executes.

# Findings
Flagged by: security-sentinel (Medium severity)

- `apps/web/src/app/components/MarkdownContent.tsx` lines 73–83: custom `a` renderer passes `href` unchecked
- Note: `rel="noopener noreferrer"` with `target="_blank"` correctly prevents tab-napping but does not block `javascript:` URIs

# Proposed Solutions

## Option A: Allowlist safe protocols (recommended)
```typescript
a({ href, children }) {
  const safeHref = href && /^https?:\/\//i.test(href) ? href : undefined;
  return (
    <a href={safeHref} target="_blank" rel="noopener noreferrer" className="...">
      {children}
    </a>
  );
},
```

## Option B: Use rehype-sanitize plugin
Add `rehype-sanitize` to react-markdown pipeline. Handles all sanitisation including protocol filtering centrally. More robust but adds a dependency.

**Recommended: Option A** — one line, no new dependency, explicit intent.

# Technical Details
- `apps/web/src/app/components/MarkdownContent.tsx`
- Low exploitability (requires LLM to echo malicious content) but high impact if triggered

# Acceptance Criteria
- [ ] `javascript:` URIs in agent-generated markdown links are stripped
- [ ] `http://` and `https://` links continue to work normally
- [ ] Relative links (`/path`) are handled safely (either allowed or stripped)

# Work Log
- 2026-02-20: Created from security-sentinel review of 4A+4B chat port PR
