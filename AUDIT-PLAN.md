# Auditor System Design

Technical design for sbomit's auditing pipeline: how a library URL becomes a
structured, persisted, AI-generated audit report.

---

## 1. Purpose

The auditor takes a single input — an npm package URL, an npm package name, or
a GitHub repository URL — plus an optional user prompt, and produces a
structured audit covering security posture, license compatibility, maintenance
health, and dependency risk. Results are deterministic in shape (Zod-validated
JSON) but probabilistic in content (LLM-generated), so the design emphasizes
guardrails: strict schemas, bounded inputs, deterministic enrichment, caching,
and typed errors.

---

## 2. System Overview

```
        ┌──────────────────────────────────────────────────────────┐
        │                        Client                             │
        │  app/page.tsx — URL/name input, prompt, report tabs       │
        └──────────────────────────┬───────────────────────────────┘
                                   │ POST /api/audit
                                   ▼
        ┌──────────────────────────────────────────────────────────┐
        │                    Pipeline (per request)                 │
        │                                                           │
        │  1. Intake        validate + normalize input              │
        │  2. Resolve       fetch npm/GitHub metadata               │
        │  3. Enrich        (planned) deterministic signals           │
        │  4. Cache check   (planned) dedupe identical audits         │
        │  5. Prompt build  assemble bounded context + user prompt    │
        │  6. LLM audit     OpenAI structured output (Zod schema)     │
        │  7. Validate      parse, clamp, sanity-check                │
        │  8. Persist       store audit + report in D1                │
        │  9. Respond       typed JSON or typed error                 │
        └──────────────────────────┬───────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        npm registry         GitHub REST API      OpenAI API
        (metadata,           (repo stats,         (structured
         advisories)          license, activity)   completion)
                                   │
                                   ▼
                          Cloudflare D1
                  (package_audits, package_dependencies,
                   audit_reports [planned])
```

---

## 3. Pipeline Stages

### 3.1 Intake & Validation

**Owner:** `app/api/audit/route.ts`

- Accept `{ libraryUrl: string, prompt?: string }`.
- Reject missing/empty `libraryUrl` with `400`.
- Normalize on the client (`normalizeUrl`): bare package names become
  `https://www.npmjs.com/package/<name>`; URLs pass through trimmed.
- Server re-validates: only npm package URLs and `github.com` URLs are
  supported; anything else → typed `UnsupportedSourceError` (currently a
  generic 500; planned: 422 with code).
- Prompt is optional, trimmed, and length-capped (planned: 1,000 chars) to
  bound token spend.

### 3.2 Library Resolution

**Owner:** `app/lib/audit.ts` (`resolveLibrary`)

Two source adapters produce a uniform `LibraryContext`:

```ts
interface LibraryContext {
  source: "npm" | "github";
  url: string;          // canonical input URL
  name: string;         // package name or owner/repo
  version: string;      // npm version, or "latest" for GitHub
  metadata: NpmMetadata | GitHubRepo;
}
```

- **npm adapter** — parses `/package/<name>` (scoped packages supported),
  fetches `https://registry.npmjs.org/<name>`, `revalidate: 0` (no Next data
  cache). 404 → `PackageNotFoundError`.
- **GitHub adapter** — parses `/<owner>/<repo>`, fetches
  `https://api.github.com/repos/<owner>/<repo>` with a `User-Agent` header.
  404 → `RepoNotFoundError`; 403 → rate-limit error (planned: attach
  `Retry-After`).

**Known gap:** GitHub resolution does not fetch `package.json`, so GitHub
audits have no dependency data. Planned: fetch `raw.githubusercontent.com`
manifest (see §7.2).

### 3.3 Enrichment (Planned)

LLM inference over raw metadata hallucinates risk details. The enrichment
layer injects **deterministic, verifiable signals** into the context before
the LLM call, and will eventually own the trust score:

| Signal                    | Source                              | Use                          |
| ------------------------- | ----------------------------------- | ---------------------------- |
| Security advisories       | npm audit endpoint / GitHub Advisories API | Verified CVE/GHSA list |
| Publish recency           | npm `time` field                    | Maintenance health           |
| Weekly downloads          | npm downloads API                   | Popularity baseline          |
| Repo activity             | GitHub `pushed_at`, open issues     | Maintenance health           |
| License SPDX id           | npm `license` / GitHub license API  | Compatibility verdict        |
| Maintainer count          | npm `maintainers` / GitHub collabs  | Bus-factor risk              |

Enrichment runs in parallel (`Promise.all`), each signal independently
failure-tolerant: a failed signal is omitted, never fatal.

### 3.4 Cache Check (Planned)

Key: `sha256(source + name + version + normalizedPrompt)` — or without the
prompt when using the default. Lookups:

1. **D1 `audit_reports`** — durable dedupe; hit returns stored report with
   `cache: "hit"` metadata.
2. **KV (optional)** — short-TTL hot cache for trending packages.

TTL policy: 24h for `latest`-version audits, effectively permanent for pinned
versions (`pkg@1.2.3`). Cache writes happen after validation (§3.7).

### 3.5 Prompt Assembly

**Owner:** `app/lib/openai.ts`

- System prompt fixes the persona ("software supply-chain auditor") and the
  behavioral constraints (factual, conservative, mark uncertainty as lower
  severity).
- User message = resolved prompt (user's or `DEFAULT_PROMPT`) + `LibraryContext`
  fields + metadata as a fenced JSON block.
- **Bounding (planned):** metadata is truncated to ~8KB before assembly —
  npm `readme` fields in particular can be megabytes. Prefer curated fields
  over the raw registry document.

### 3.6 LLM Audit

**Owner:** `app/lib/openai.ts` (`runLibraryAudit`)

- Model: `gpt-4o-mini` — cost/latency sweet spot for structured extraction.
- Mechanism: `chat.completions.parse` with
  `zodResponseFormat(auditResultSchema, "audit_result")` — OpenAI structured
  outputs guarantee schema-conformant JSON (no free-text parsing).
- One call per audit; no tool use, no streaming (response is consumed as a
  single JSON document).
- Failure modes: refusal / unparsed completion → `AuditParseError`
  (planned: one retry with a stricter system reminder, then 502).

### 3.7 Validation & Post-Processing

The Zod schema is the contract:

```ts
auditResultSchema = {
  name, version,
  score: number (0–100),
  summary: string,
  risks: [{ severity: critical|high|medium|low, title, description }],
  dependencies: [{ name, version, license, transitive }],
  license: { type, compatible, note },
  maintainers: string[],
  lastPublished: string,
  weeklyDownloads: string,
}
```

Post-parse checks (planned):

- Clamp/dedupe risks; cap list lengths (risks ≤ 20, dependencies ≤ 500).
- Cross-check `name`/`version` against resolved context; override if the
  model drifted.
- When enrichment is live: recompute `score` deterministically from signals
  and use the LLM score only as a fallback (see §5).

### 3.8 Persistence

**Owner:** `app/lib/db.ts`, `migrations/`

Current schema (`0001_initial.sql`):

- `package_audits` — one row per audited library URL.
- `package_dependencies` — dependency rows keyed by `audit_id`
  (populated by `/api/dependencies`, not by `/api/audit`).

Planned (`0002_audit_reports.sql`):

```sql
CREATE TABLE audit_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL REFERENCES package_audits(id) ON DELETE CASCADE,
  prompt TEXT,                 -- NULL when default
  model TEXT NOT NULL,         -- e.g. "gpt-4o-mini"
  score INTEGER NOT NULL,
  result_json TEXT NOT NULL,   -- full validated AuditResult
  cache_key TEXT UNIQUE,       -- §3.4 dedupe key
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Write path: insert `package_audits` row → insert `audit_reports` row →
insert dependency rows in one `db.batch` (matching the existing
`saveDependencyTree` pattern).

### 3.9 Response

- Success: `{ result: AuditResult, meta: { cached: boolean, auditId } }`.
- Errors: `{ error: string, code: ErrorCode }` with appropriate status
  (400 input, 404 not found, 429 rate-limited, 502 upstream/LLM).

---

## 4. Error Taxonomy

| Error                    | Where raised            | Status | Client message intent            |
| ------------------------ | ----------------------- | ------ | -------------------------------- |
| `MissingInputError`      | intake                  | 400    | "libraryUrl is required"         |
| `UnsupportedSourceError` | resolve                 | 422    | supported URL formats            |
| `PackageNotFoundError`   | npm adapter             | 404    | package not found                |
| `RepoNotFoundError`      | GitHub adapter          | 404    | repo not found / private         |
| `UpstreamRateLimitError` | adapters / OpenAI       | 429    | retry after N seconds            |
| `EnrichmentUnavailable`  | enrichment              | —      | non-fatal; signal omitted        |
| `AuditParseError`        | LLM stage               | 502    | audit failed, safe to retry      |
| `DbUnavailableError`     | `getDb()` (no binding)  | 500    | misconfiguration (already exist) |

Rule: expected upstream failures never surface as bare 500s.

---

## 5. Scoring Model (Target)

Today the 0–100 trust score is fully LLM-assigned. Target: a deterministic
rubric computed from enrichment signals, with the LLM score as fallback.

```
score = 100
      - Σ severityWeights[advisory severity]   (verified advisories)
      - maintenancePenalty                     (staleness, low activity)
      - busFactorPenalty                       (single maintainer)
      - licensePenalty                         (unknown/copyleft vs policy)
      + popularityBonus (capped)               (downloads, stars)
clamp(0, 100)
```

Severity bands: ≥80 healthy, 60–79 caution, <60 review required — matches the
existing `scoreVariant` thresholds in `app/page.tsx`.

---

## 6. Cross-Cutting Concerns

### Rate Limiting

Per-IP token bucket on `/api/audit` (the only OpenAI-cost route). Workers-
compatible implementation (D1 counter or KV), e.g. 10 audits/IP/hour
anonymous. Turnstile gate if abuse appears (see TODO §4.4).

### Cost Guardrails

- One OpenAI call per audit; bounded context (~8KB metadata cap).
- Cache hits cost zero.
- Track `usage.total_tokens` per audit in `audit_reports` (planned column)
  for spend monitoring.

### Security

- `OPENAI_API_KEY` only via env/Wrangler secrets; never client-side.
- Outbound fetches restricted to npm registry, GitHub API, and
  `raw.githubusercontent.com` — no user-controlled URLs fetched directly
  (SSRF guard: resolution parses and rebuilds URLs; it never fetches the
  raw user input).
- All API input validated server-side regardless of client normalization.

### Performance Budget

- Cached audit: < 500ms p50.
- Fresh audit: < 15s p50 (LLM-bound); enrichment adds ≤ 1s (parallel).
- No streaming today; if audit latency becomes a UX issue, stream
  progressive sections rather than the whole JSON doc.

---

## 7. Extension Points

1. **Source adapters** — new sources (PyPI, crates.io) implement the
   `LibraryContext` adapter contract; the rest of the pipeline is unchanged.
2. **Signals** — new enrichment signals register in the enrichment registry
   and optionally extend the scoring rubric.
3. **GitHub manifest fetch** — pull `package.json` from the default branch to
   close the GitHub dependency gap (`/api/dependencies` parity with npm).
4. **Re-audit scheduling** — Cron Trigger re-runs audits for watchlisted
   packages and diffs against the previous `audit_reports` row (v2).

---

## 8. Implementation Map

| Stage             | File                              | State    |
| ----------------- | --------------------------------- | -------- |
| Intake            | `app/api/audit/route.ts`          | shipped  |
| Resolution        | `app/lib/audit.ts`                | shipped  |
| Enrichment        | `app/lib/signals.ts` (new)        | planned  |
| Cache             | `app/lib/cache.ts` (new)          | planned  |
| LLM audit         | `app/lib/openai.ts`               | shipped  |
| Validation        | `app/lib/audit.ts` (schema)       | shipped, post-checks planned |
| Persistence       | `app/lib/db.ts`, `migrations/`    | partial  |
| Rate limiting     | `app/lib/rate-limit.ts` (new)     | planned  |
| Scoring rubric    | `app/lib/score.ts` (new)          | planned  |
