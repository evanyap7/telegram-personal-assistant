<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Deterministic check (backpressure)
Before saying a task is done, or committing, run `npm run check` (tsc, eslint, all offline test
suites) and read the output. If it fails, fix the cause; never skip hooks (`--no-verify`) or
loosen the config to get green. Report the actual result. The pre-commit hook (husky) runs the
same command.
