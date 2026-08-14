# sbomit

AI-powered security audits for npm libraries and GitHub repositories. Paste a package URL or name, add an optional prompt, and get a structured report covering security posture, license compatibility, maintenance health, and dependency risk.

## Features

- **Instant audits** — Analyze any npm package or GitHub repo with a single request.
- **AI-generated reports** — Uses structured outputs (Zod schema) for consistent, machine-readable results.
- **Trust score** — 0–100 score with severity-ranked risks.
- **Dependency tree** — Save direct, dev, peer, and optional dependencies to a Cloudflare D1 database.
- **npm autocomplete** — Search the npm registry as you type.
- **Custom prompts** — Tailor the audit to your product context (e.g. fintech supply-chain risks).

## Tech Stack

- [Next.js](https://nextjs.org) 16 (App Router)
- [React](https://react.dev) 19 + TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4
- [Cloudflare Workers](https://workers.cloudflare.com) + [D1](https://developers.cloudflare.com/d1/)
- LLM provider abstraction (OpenAI-compatible, Anthropic Claude, Google Gemini)

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
    llm.ts          LLM client (OpenAI-compatible, Claude, Gemini)
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
- API keys for at least one supported LLM provider:
  - [OpenAI](https://platform.openai.com/api-keys) or any OpenAI-compatible endpoint
  - [Anthropic](https://console.anthropic.com/settings/keys) (Claude)
  - [Google AI Studio](https://aistudio.google.com/app/apikey) (Gemini)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your LLM credentials to `.env.local`:

   ```bash
   # Pick a provider: openai (default), anthropic, or google
   LLM_PROVIDER=openai
   LLM_API_KEY=sk-your-openai-api-key-here

   # Optional: override the model or point to a custom OpenAI-compatible endpoint
   # LLM_MODEL=gpt-4o-mini
   # LLM_BASE_URL=https://api.openai.com/v1
   ```

   Provider-specific examples:

   ```bash
   # Anthropic Claude
   LLM_PROVIDER=anthropic
   LLM_API_KEY=sk-ant-api03-...
   LLM_MODEL=claude-3-5-sonnet-20241022

   # Google Gemini
   LLM_PROVIDER=google
   LLM_API_KEY=...
   LLM_MODEL=gemini-1.5-flash-latest

   # Any OpenAI-compatible endpoint (e.g. OpenRouter, local llama.cpp)
   LLM_PROVIDER=openai
   LLM_API_KEY=...
   LLM_BASE_URL=https://openrouter.ai/api/v1
   LLM_MODEL=meta-llama/llama-3.1-70b-instruct
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
