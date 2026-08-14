# sbomit

AI-powered security audits for npm libraries and GitHub repositories. Paste a package URL or name, add an optional prompt, and get a structured report covering security posture, license compatibility, maintenance health, and dependency risk.

## Features

- **Instant audits** — Analyze any npm package or GitHub repo with a single request.
- **AI-generated reports** — Uses OpenAI structured outputs (Zod schema) for consistent, machine-readable results.
- **Trust score** — 0–100 score with severity-ranked risks.
- **Dependency tree** — Save direct, dev, peer, and optional dependencies to a Cloudflare D1 database.
- **npm autocomplete** — Search the npm registry as you type.
- **Custom prompts** — Tailor the audit to your product context (e.g. fintech supply-chain risks).

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
    audit/          POST → run an AI audit
    dependencies/   POST → save dependency tree to D1
    search/         GET  → npm package autocomplete
  components/ui/    Tailwind/shadcn-style UI primitives
  lib/
    audit.ts        Library resolution (npm/GitHub) + Zod schemas
    db.ts           D1 helpers
    openai.ts       OpenAI structured-output client
  page.tsx          Main UI
migrations/         D1 SQL migrations
scripts/
  apply-migrations.sh  Apply local/remote D1 migrations + regenerate types
wrangler.jsonc      Cloudflare Worker + D1 configuration
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

2. Add your OpenAI key to `.env.local`:

   ```bash
   OPENAI_API_KEY=sk-your-openai-api-key-here
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

Run an AI audit on a library.

```json
{
  "libraryUrl": "https://www.npmjs.com/package/lodash",
  "prompt": "Focus on supply-chain risks for a fintech product."
}
```

Returns a structured `AuditResult` with score, summary, risks, dependencies, license, and metadata.

### `POST /api/dependencies`

Resolve and persist a dependency tree to D1.

```json
{
  "libraryUrl": "https://www.npmjs.com/package/express"
}
```

Returns the saved audit ID and dependency list.

### `GET /api/search?q=<query>`

Search npm packages for autocomplete.

## License

MIT
