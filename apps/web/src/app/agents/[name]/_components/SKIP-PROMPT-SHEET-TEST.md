# SKIP: PromptSheet reset-on-close test

## Untested behavior

`PromptSheet` mounts `PromptSheetBody` only while `open={true}`. When the sheet
closes (`open` prop flips to `false`), React unmounts `PromptSheetBody`, which
naturally discards `promptDraft` state. On reopen the body remounts and
re-initialises `promptDraft` from `agent.system_prompt`. The intended test would:

1. Mount `<PromptSheet open agent={…} onOpenChange={…} />`
2. Simulate a textarea edit (`promptDraft` becomes dirty)
3. Close the sheet (`open=false`) → body unmounts
4. Reopen (`open=true`) → body remounts
5. Assert `textarea.value === agent.system_prompt` (draft was discarded)

## Why skipped

`apps/web/package.json` has no `@testing-library/react`, `jsdom`, or `happy-dom`
devDependencies and `vitest.config.ts` has no `environment: "jsdom"`. Mounting a
React component in Vitest requires both. Installing them was out of scope per
task instructions.

## What to do

```bash
pnpm add -D @testing-library/react @testing-library/user-event happy-dom
```

Then add `environment: "happy-dom"` (or `"jsdom"`) to `vitest.config.ts` and
write the test in a `.test.tsx` file.
