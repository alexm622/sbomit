# sbomit — Scope, Features & Roadmap

> Working document for planning. Checkboxes track progress; sections describe
> intended scope, backend requirements, and target structure.

---

## 1. Product Scope

### Vision

sbomit is a supply-chain due-diligence tool for JavaScript teams. Given an npm
package or GitHub repository, it produces an AI-assisted audit covering
security posture, license compatibility, maintenance health, and dependency
risk — and persists dependency trees for ongoing tracking.

### Goals

- Instant, structured audits from a single URL or package name.
- Consistent machine-readable results (Zod-validated OpenAI output).
- Persistent dependency inventory backed by Cloudflare D1.
- Audits reproducible and shareable (stored, linkable results).

### Non-Goals (for now)

- Full SBOM generation (CycloneDX/SPDX export) — future consideration.
- Continuous vulnerability scanning / alerting.
- Private registry support.
- Auth-gated multi-tenant orgs (single-user/local-first first).

---

## 2. Current State (Shipped)

- [x] Next.js 16 App Router UI with Tailwind v4 + shadcn-style components.
- [x] `POST /api/audit` — resolves npm/GitHub metadata, runs OpenAI
      structured-output audit (`gpt-4o-mini`, Zod schema).
- [x] `POST /api/dependencies` — extracts and persists direct/dev/peer/
      optional deps to D1.
- [x] `GET /api/search` — npm registry autocomplete.
- [x] D1 schema: `package_audits`, `package_dependencies`
      (`migrations/0001_initial.sql`).
- [x] Migration script `scripts/apply-migrations.sh` (local + remote + types).
- [x] Audit report UI: overview / risks / dependencies / license tabs.

---

## 3. Feature Roadmap

### 3.1 MVP Polish (next up)

- [x] Persist full audit results to D1 (new `audit_reports` table) so reports
      survive reloads and can be retrieved by ID.
- [x] Shareable report URLs (`/report/[id]`) backed by stored audits.
- [x] Basic request validation + rate limiting on API routes (per-IP token
      bucket; Cloudflare Workers compatible).
- [x] Error handling polish: typed error responses, user-friendly messages
      for npm 404s, GitHub rate limits, OpenAI failures.
- [ ] Loading/empty states audit; accessibility pass on tabs and autocomplete.
- [ ] `.dev.vars` / secrets documentation; `wrangler.jsonc` real `database_id`.
- [ ] CI: lint + typecheck on PRs.

### 3.2 v1 — Trust & Depth

- [ ] npm audit data integration (registry advisories) merged with AI output.
- [x] GitHub manifest fetch (`package.json` from default branch) for dependency parity.
- [ ] GitHub deeper signals: release cadence, issue SLA, bus factor via API.
- [ ] License compatibility matrix (declare project license, get verdict).
- [ ] Diff audits between two versions of a package.
- [ ] Export report as Markdown / JSON download.
- [ ] Transitive dependency resolution (walk lockfile-style graph, depth-capped).
- [x] Caching layer: dedupe identical audits within N hours (D1 lookup).

### 3.3 v2 — Product Surface

- [ ] Watchlists: track a set of packages, re-audit on schedule (Cron Trigger).
- [ ] Change detection: notify when audit score or dep tree changes.
- [ ] API tokens + public REST API for CI usage (`sbomit audit <pkg>` gate).
- [ ] Optional auth (Cloudflare Access or simple email magic link).
- [ ] Org-level license policy engine (allow/deny lists).

### 3.4 Exploratory / Maybe

- [ ] True SBOM export (CycloneDX).
- [ ] Embeddings-based "similar but safer package" suggestions (Vectorize).
- [ ] Badge endpoint (`img.shields.io`-style score badge for READMEs).

---

## 4. Backend Requirements

### 4.1 Data Model (D1)

Current:

- `package_audits` (id, name, version, source, url, audited_at)
- `package_dependencies` (id, audit_id, name, version, dependency_type)

Planned:

- [x] `audit_reports` — id, audit_id FK, prompt, model, score, result_json
      (full structured output), cache_key, created_at.
- [ ] `watchlists` / `watchlist_packages` — v2 tracking.
- [ ] `api_tokens` — v2 public API.
- [ ] Migrations numbered sequentially (`0002_*.sql`, ...); applied via
      `scripts/apply-migrations.sh`.

### 4.2 API Surface

| Route                    | Method | Status  | Notes                                |
| ------------------------ | ------ | ------- | ------------------------------------ |
| `/api/audit`             | POST   | shipped | Returns audit; will also persist.    |
| `/api/dependencies`      | POST   | shipped | Saves dep tree.                      |
| `/api/search`            | GET    | shipped | npm autocomplete.                    |
| `/api/reports/[id]`      | GET    | planned | Fetch stored report.                 |
| `/api/health`            | GET    | planned | Liveness + binding check.            |
| `/api/watchlists`        | CRUD   | v2      | Requires auth.                       |

### 4.3 External Services

- [x] OpenAI API (`OPENAI_API_KEY` secret; `wrangler secret put` in prod).
- [x] npm registry (unauthenticated; respect rate limits).
- [x] GitHub REST API (unauthenticated; add token for higher limits).
- [ ] Optional: `GITHUB_TOKEN` secret for 5k req/hr.
- [ ] Optional: KV namespace for audit caching.

### 4.4 Infra / Ops

- [x] Cloudflare Workers runtime (`nodejs_compat`), wrangler v4.
- [x] D1 database `sbomit-deps`.
- [ ] Turnstile on audit endpoint if abuse appears.
- [ ] Observability: Workers Logs + structured console events; track OpenAI
      token usage per audit.
- [ ] Cost guardrails: max metadata payload size into prompt; daily spend cap
      alert (OpenAI dashboard side).

---

## 5. Target Application Structure

```
app/
  layout.tsx / page.tsx          # landing + audit form (client)
  report/[id]/page.tsx           # shipped: persisted report view
  audits/page.tsx                # shipped: history + inline report view
  api/
    audit/route.ts               # shipped
    dependencies/route.ts        # shipped
    search/route.ts              # shipped
    audits/[id]/route.ts         # shipped
    health/route.ts              # planned
  components/ui/                 # primitives (shipped)
  components/                    # shipped: report-view, audit-jobs, site-header
  lib/
    audit.ts                     # resolution + schemas (shipped)
    llm.ts                       # structured-output client (shipped)
    db.ts                        # D1 helpers (shipped)
    signals.ts                   # shipped: enrichment signals
    score.ts                     # shipped: deterministic scoring
    cache.ts                     # shipped: D1 dedupe helpers
    rate-limit.ts                # shipped
migrations/                      # sequential SQL migrations
scripts/apply-migrations.sh      # shipped
wrangler.jsonc                   # bindings: D1, (KV), vars
TODO.md                          # this file
README.md                        # user-facing docs
```

---

## 6. Non-Functional Requirements

- **Performance**: audit p50 < 15s (OpenAI-bound); cached re-audit < 500ms.
- **Reliability**: API routes never 500 on expected upstream failures; typed
  4xx for user errors.
- **Security**: secrets only via env/Wrangler secrets; no keys client-side;
  input URL validation (npm/GitHub only).
- **Cost**: single OpenAI call per audit; metadata truncated to ~8KB before
  prompt assembly.

---

## 7. Open Questions

- Do audits need authentication before public deployment (abuse/cost risk)?
- Cache TTL for identical package+version audits (24h? 7d?)?
- Should GitHub repos resolve their package.json deps server-side (raw file
  fetch) to close the "GitHub source has no deps" gap?
- Version pinning: audit `latest` only, or accept `pkg@version` syntax?
