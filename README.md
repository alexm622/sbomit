# sbomit

AI-powered security audits for npm libraries and GitHub repositories. Paste a package URL or name, add an optional prompt, and get a structured report covering security posture, license compatibility, maintenance health, and dependency risk.

## Features

- **Instant audits** — Analyze any npm package or GitHub repo with a single request.
- **AI-generated reports** — Uses OpenAI structured outputs (Zod schema) for consistent, machine-readable results.
- **Trust score** — 0–100 score with severity-ranked risks.
- **Dependency tree** — Save direct, dev, peer, and optional dependencies to a Cloudflare D1 database.
- **Transitive dependency resolution** — Walk the npm dependency graph depth-capped up to 3 levels.
- **Persisted reports** — Every audit is stored in D1 and gets a shareable `/report/[id]` URL.
- **Rate limiting** — Per-IP token bucket on API routes.
- **npm autocomplete** — Search the npm registry as you type.
- **Custom prompts** — Tailor the audit to your product context (e.g. fintech supply-chain risks).
- **Report export** — Download audit results as Markdown or JSON.
- **Health check** — `GET /api/health` verifies D1 and OpenAI bindings.

## Tech Stack

- [Next.js](https://nextjs.org) 16 (App Router)
- [React](https://react.dev) 19 + TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4
- [Cloudflare Workers](https://workers.cloudflare.com) + [D1](https://developers.cloudflare.com/d1/)
- [OpenAI](https://openai.com) GPT-4o-mini

## Project Structure

```
app/
  api/
    audit/                POST → run an AI audit and persist report
    dependencies/         POST → save direct dependency tree to D1
    dependencies/transitive/  POST → walk transitive deps depth-capped
    search/               GET  → npm package autocomplete
    reports/[id]/         GET  → fetch a stored report
    health/               GET  → liveness + binding check
  components/
    ui/                   Tailwind/shadcn-style UI primitives
    report-view.tsx       Reusable report renderer + export
  lib/
    audit.ts              Library resolution (npm/GitHub) + Zod schemas
    db.ts                 D1 helpers
    openai.ts             OpenAI structured-output client
    dependencies.ts       Transitive dependency walker
    rate-limit.ts         Per-IP token bucket
    errors.ts             Typed API error helpers
  page.tsx                Main UI
  report/[id]/            Shareable persisted report page
migrations/               D1 SQL migrations
scripts/
  apply-migrations.sh     Apply local/remote D1 migrations + regenerate types
wrangler.jsonc            Cloudflare Worker + D1 configuration
.dev.vars.example         Local secrets template
```

## Prerequisites

- Node.js 20+
- npm
- A Cloudflare account
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the local secrets template:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   Edit `.dev.vars` and add your OpenAI key (and optional GitHub token for higher rate limits):

   ```bash
   OPENAI_API_KEY=sk-your-openai-api-key-here
   GITHUB_TOKEN=ghp-your-github-token-here
   ```

3. Configure your D1 database in `wrangler.jsonc`:

   ```jsonc
   {
     "d1_databases": [
       {
         "binding": "DB",
         "database_name": "sbomit-deps",
         "database_id": "<your-database-id>",
         "migrations_dir": "./migrations"
       }
     ]
   }
   ```

4. Apply migrations locally (and optionally remotely):

   ```bash
   ./scripts/apply-migrations.sh
   ```

## Development

Run the Next.js dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To test D1-bound routes locally, use Wrangler:

```bash
npx wrangler dev
```

### Tests

Tests run inside the Cloudflare Workers runtime using `@cloudflare/vitest-pool-workers`:

```bash
npm run test
```

This applies D1 migrations to an isolated local database and runs unit/integration tests for library resolution, rate limiting, error handling, dependency walking, and D1 helpers.

## Deployment

Deploy to Cloudflare Workers:

```bash
npx wrangler deploy
```

Make sure remote D1 migrations are applied before deploying:

```bash
npx wrangler d1 migrations apply sbomit-deps --remote
```

## API

### `POST /api/audit`

Run an AI audit on a library. Persists the package metadata, dependency tree, and full report to D1.

```json
{
  "libraryUrl": "https://www.npmjs.com/package/lodash",
  "prompt": "Focus on supply-chain risks for a fintech product."
}
```

Returns a structured `AuditResult`, `reportId`, and a `cached` flag. Identical URLs within 24 hours return a cached report.

### `POST /api/dependencies`

Resolve and persist a direct dependency tree to D1.

```json
{
  "libraryUrl": "https://www.npmjs.com/package/express"
}
```

Returns the saved audit ID and dependency list.

### `POST /api/dependencies/transitive`

Walk the npm dependency graph depth-capped (default depth 2, max 3).

```json
{
  "libraryUrl": "https://www.npmjs.com/package/express",
  "maxDepth": 2,
  "includeDev": false
}
```

### `GET /api/reports/[id]`

Fetch a stored audit report by its public ID.

### `GET /api/health`

Liveness check. Returns `ok`/`degraded` and binding status.

### `GET /api/search?q=<query>`

Search npm packages for autocomplete.

## License

MIT
