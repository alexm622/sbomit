<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# sbomit agent guide

AI-powered security audits for npm libraries and GitHub repositories. Deployed on Cloudflare Workers via OpenNext.

## Common commands

```bash
# Development (Next.js dev server with Cloudflare bindings)
npm run dev

# Tests (run inside the Workers runtime via vitest-pool-workers)
npm run test
npm run test:watch

# Lint / typecheck
npm run lint
npm run typecheck          # runs next typegen && wrangler types && tsc --noEmit

# Build and preview/deploy the Worker
npm run preview            # opennextjs-cloudflare build + preview
npm run deploy             # opennextjs-cloudflare build + deploy
```

## Architecture

- Next.js 16 App Router with React 19.
- Runtime: Cloudflare Workers (D1, no KV).
- OpenNext (`@opennextjs/cloudflare`) builds `.open-next/worker.js`.
- `next start` / `next build` alone are **not** the deploy path.

## Local setup

1. `cp .dev.vars.example .dev.vars` and fill in:
   - `OPENAI_API_KEY` (or whichever LLM provider you use)
   - `AUTH_SECRET` (required for session cookie signing)
   - Optional `GITHUB_TOKEN`
2. Configure your D1 database in `wrangler.jsonc` (`d1_databases[0].database_id`).
3. Run migrations: `npm run db:migrate` (or `./scripts/apply-migrations.sh`).
4. `wrangler types` regenerates `worker-configuration.d.ts` (gitignored, do not commit).

## Tests

- Tests run in the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`.
- Colocated `*.test.ts` files live next to the code they test.
- D1 migrations are applied to an isolated test database via `test/apply-migrations.ts` and the `TEST_MIGRATIONS` binding in `vitest.config.mjs`.

## Code conventions

- Prefer typed `AuditError` from `app/lib/errors.ts` for API failures. Use `handleApiError` in route handlers (or `withErrorHandling` from `app/lib/api.ts`).
- Validate API input with Zod. Use `parseJsonBody` + `parseWithSchema` from `app/lib/api.ts`.
- D1 access goes through `app/lib/db` helpers; never construct `env.DB` directly in routes.
- Shared path alias is `@/*` (configured in `tsconfig.json`).
- Migrations are SQL files in `migrations/` named `NNNN_snake_case.sql` and are applied in order.
- The `app/lib/db/` and `app/lib/llm/` modules are split by domain; import from the barrel `@/app/lib/db` or `@/app/lib/llm` unless you need an internal helper.

## When modifying this file

If you change build/test commands, deployment workflow, or conventions, update this guide.
