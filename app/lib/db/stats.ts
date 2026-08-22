import type { StoredAuditReportSummary } from "./audits";

export interface UserStats {
  auditsRun: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  successes: number;
  failures: number;
}

export async function getUserStats(
  db: D1Database,
  userId: number,
): Promise<UserStats> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(r.id) AS audits_run,
         COALESCE(SUM(JSON_EXTRACT(r.interaction_json, '$.tokensInput')), 0) AS tokens_input,
         COALESCE(SUM(JSON_EXTRACT(r.interaction_json, '$.tokensOutput')), 0) AS tokens_output,
         COALESCE(SUM(r.tokens_total), 0) AS tokens_total,
         COALESCE(SUM(CASE WHEN r.score IS NOT NULL THEN 1 ELSE 0 END), 0) AS successes,
         0 AS failures
       FROM package_audits a
       JOIN audit_reports r ON r.audit_id = a.id
       WHERE a.user_id = ?`,
    )
    .bind(userId)
    .first<{
      audits_run: number;
      tokens_input: number;
      tokens_output: number;
      tokens_total: number;
      successes: number;
      failures: number;
    }>();

  return {
    auditsRun: Number(row?.audits_run ?? 0),
    tokensInput: Number(row?.tokens_input ?? 0),
    tokensOutput: Number(row?.tokens_output ?? 0),
    tokensTotal: Number(row?.tokens_total ?? 0),
    successes: Number(row?.successes ?? 0),
    failures: Number(row?.failures ?? 0),
  };
}

export async function listUserAuditReports(
  db: D1Database,
  userId: number,
): Promise<StoredAuditReportSummary[]> {
  const result = await db
    .prepare(
      `SELECT r.id, r.audit_id, r.prompt, r.model, r.score, r.created_at,
              a.name, a.version, a.source, a.url,
              JSON_EXTRACT(r.interaction_json, '$.provider') AS provider,
              JSON_EXTRACT(r.interaction_json, '$.tokensInput') AS tokens_input,
              JSON_EXTRACT(r.interaction_json, '$.tokensOutput') AS tokens_output,
              r.tokens_total,
              JSON_EXTRACT(r.interaction_json, '$.startedAt') AS started_at,
              JSON_EXTRACT(r.interaction_json, '$.finishedAt') AS finished_at,
              r.codebase_inspected
       FROM audit_reports r
       JOIN package_audits a ON a.id = r.audit_id
       WHERE a.user_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
    )
    .bind(userId)
    .all<StoredAuditReportSummary>();
  return result.results || [];
}

export interface ModelTokenBreakdown {
  model: string;
  tokens: number;
  audits: number;
  avgTokens: number;
}

export interface ProviderTokenBreakdown {
  provider: string;
  tokens: number;
  audits: number;
  avgTokens: number;
}

export interface TokensOverTime {
  date: string;
  tokens: number;
  audits: number;
}

export interface ScoreDistribution {
  range: string;
  audits: number;
}

export interface DailyActiveUsers {
  date: string;
  users: number;
}

export interface ProviderBudgetUtilization {
  id: string;
  name: string;
  limit: number;
  used: number;
  pct: number;
}

export interface TopUser {
  id: number;
  username: string;
  fullName: string;
  auditsRun: number;
  tokensTotal: number;
}

export interface OverallStats {
  totalAudits: number;
  totalUsers: number;
  totalTokens: number;
  tokensToday: number;
  auditsToday: number;
  avgTokensPerAudit: number;
  estimatedSpend: number;
  cacheHitRate: number;
  avgAuditDurationMs: number;
  tokensOverTime: TokensOverTime[];
  tokensByModel: ModelTokenBreakdown[];
  tokensByProvider: ProviderTokenBreakdown[];
  scoreDistribution: ScoreDistribution[];
  dailyActiveUsers: DailyActiveUsers[];
  providerBudgetUtilization: ProviderBudgetUtilization[];
  topUsers: TopUser[];
}

// Rough per-model pricing in USD per 1M tokens. Used for cost estimates.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o1-mini": { input: 1.1, output: 4.4 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "gemini-1.5-flash-latest": { input: 0.35, output: 0.53 },
  "gemini-1.5-pro-latest": { input: 3.5, output: 10.5 },
  "kimi-k2.7-code": { input: 0.5, output: 2 },
  "kimi-k3": { input: 2, output: 8 },
  "moonshot-v1-8k": { input: 0.5, output: 1.5 },
};

const DEFAULT_PRICING = { input: 2, output: 6 };

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// Aggregate per-interaction tokens across audit reports. Handles both a single
// interaction object and an array of interactions stored in interaction_json.
// It also infers a more specific provider name (e.g. Moonshot, DeepSeek) from
// the model when an OpenAI-compatible endpoint was used.
const interactionBreakdownCte = `
  interactions AS (
    SELECT
      r.id,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN JSON_EXTRACT(j.value, '$.provider')
        ELSE JSON_EXTRACT(r.interaction_json, '$.provider')
      END AS provider,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN JSON_EXTRACT(j.value, '$.providerId')
        ELSE JSON_EXTRACT(r.interaction_json, '$.providerId')
      END AS provider_id,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN JSON_EXTRACT(j.value, '$.model')
        ELSE JSON_EXTRACT(r.interaction_json, '$.model')
      END AS model,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN
          COALESCE(JSON_EXTRACT(j.value, '$.tokensInput'), 0)
        ELSE
          COALESCE(JSON_EXTRACT(r.interaction_json, '$.tokensInput'), 0)
      END AS input_tokens,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN
          COALESCE(JSON_EXTRACT(j.value, '$.tokensOutput'), 0)
        ELSE
          COALESCE(JSON_EXTRACT(r.interaction_json, '$.tokensOutput'), 0)
      END AS output_tokens
    FROM audit_reports r
    LEFT JOIN JSON_EACH(r.interaction_json) AS j ON JSON_TYPE(r.interaction_json) = 'array'
  ),
  inferred AS (
    SELECT
      id,
      provider_id,
      CASE
        WHEN provider = 'openai' AND (LOWER(model) LIKE '%moonshot%' OR LOWER(model) LIKE '%kimi%') THEN 'moonshot'
        WHEN provider = 'openai' AND LOWER(model) LIKE '%deepseek%' THEN 'deepseek'
        ELSE provider
      END AS provider,
      model,
      input_tokens,
      output_tokens,
      input_tokens + output_tokens AS tokens
    FROM interactions
  )
`;

export async function getOverallStats(db: D1Database): Promise<OverallStats> {
  const today = new Date().toISOString().slice(0, 10);
  const [
    totals,
    overTime,
    duration,
    scoreDistribution,
    dailyActiveUsers,
    providerBudget,
    byModel,
    byProvider,
    topUsers,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM audit_reports) AS total_audits,
           (SELECT COUNT(*) FROM users) AS total_users,
           (SELECT COALESCE(SUM(tokens_total), 0) FROM audit_reports) AS total_tokens,
           (SELECT COALESCE(SUM(tokens_total), 0) FROM provider_usage WHERE usage_date = ?) AS tokens_today,
           (SELECT COUNT(*) FROM audit_reports WHERE created_at >= datetime('now', 'start of day')) AS audits_today,
           (SELECT COALESCE(SUM(cache_hits), 0) FROM audit_reports) AS total_cache_hits`,
      )
      .bind(today)
      .first<{
        total_audits: number;
        total_users: number;
        total_tokens: number;
        tokens_today: number;
        audits_today: number;
        total_cache_hits: number;
      }>(),
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at) AS date,
                COALESCE(SUM(tokens_total), 0) AS tokens,
                COUNT(*) AS audits
         FROM audit_reports
         WHERE created_at >= datetime('now', '-30 days')
         GROUP BY date
         ORDER BY date ASC`,
      )
      .all<{ date: string; tokens: number; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT AVG(
           (julianday(finished_at) - julianday(started_at)) * 24 * 60 * 60 * 1000
         ) AS avg_duration_ms
         FROM audit_reports
         WHERE cached = 0 AND started_at IS NOT NULL AND finished_at IS NOT NULL`,
      )
      .first<{ avg_duration_ms: number }>(),
    db
      .prepare(
        `SELECT
           CASE
             WHEN score >= 90 THEN '90-100'
             WHEN score >= 80 THEN '80-89'
             WHEN score >= 70 THEN '70-79'
             WHEN score >= 60 THEN '60-69'
             WHEN score >= 50 THEN '50-59'
             ELSE '0-49'
           END AS range,
           COUNT(*) AS audits
         FROM audit_reports
         GROUP BY range
         ORDER BY range DESC`,
      )
      .all<{ range: string; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', r.created_at) AS date, COUNT(DISTINCT a.user_id) AS users
         FROM audit_reports r
         JOIN package_audits a ON a.id = r.audit_id
         WHERE r.created_at >= datetime('now', '-30 days')
         GROUP BY date
         ORDER BY date ASC`,
      )
      .all<{ date: string; users: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT
           p.id,
           p.name,
           pl.daily_token_limit AS daily_limit,
           COALESCE((SELECT SUM(tokens_total) FROM provider_usage WHERE provider_id = p.id AND usage_date = ?), 0) AS used
         FROM providers p
         JOIN provider_limits pl ON pl.provider_id = p.id
         ORDER BY p.name`,
      )
      .bind(today)
      .all<{ id: string; name: string; daily_limit: number; used: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `WITH ${interactionBreakdownCte}
         SELECT model, SUM(tokens) AS tokens, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(DISTINCT id) AS audits
         FROM inferred
         WHERE model IS NOT NULL
         GROUP BY model
         ORDER BY tokens DESC`,
      )
      .all<{ model: string; tokens: number; input_tokens: number; output_tokens: number; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `WITH ${interactionBreakdownCte}
         SELECT COALESCE(p.name, i.provider) AS provider, SUM(i.tokens) AS tokens, COUNT(DISTINCT i.id) AS audits
         FROM inferred i
         LEFT JOIN providers p ON p.id = i.provider_id
         WHERE i.provider IS NOT NULL OR p.name IS NOT NULL
         GROUP BY COALESCE(p.id, i.provider), COALESCE(p.name, i.provider)
         ORDER BY tokens DESC`,
      )
      .all<{ provider: string; tokens: number; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT
           u.id,
           u.username,
           u.full_name,
           COUNT(r.id) AS audits_run,
           COALESCE(SUM(r.tokens_total), 0) AS tokens_total
         FROM users u
         JOIN package_audits a ON a.user_id = u.id
         JOIN audit_reports r ON r.audit_id = a.id
         GROUP BY u.id, u.username, u.full_name
         ORDER BY tokens_total DESC
         LIMIT 10`,
      )
      .all<{ id: number; username: string; full_name: string; audits_run: number; tokens_total: number }>()
      .then((r) => r.results || []),
  ]);

  const totalAudits = Number(totals?.total_audits ?? 0);
  const totalTokens = Number(totals?.total_tokens ?? 0);
  const totalCacheHits = Number(totals?.total_cache_hits ?? 0);
  const cacheRequests = totalCacheHits + totalAudits;

  const tokensByModel = byModel.map((row) => ({
    model: row.model,
    tokens: Number(row.tokens),
    audits: Number(row.audits),
    avgTokens: row.audits > 0 ? Math.round(Number(row.tokens) / Number(row.audits)) : 0,
  }));

  const estimatedSpend = byModel.reduce(
    (sum, row) =>
      sum +
      estimateCost(
        row.model,
        Number(row.input_tokens),
        Number(row.output_tokens),
      ),
    0,
  );

  return {
    totalAudits,
    totalUsers: Number(totals?.total_users ?? 0),
    totalTokens,
    tokensToday: Number(totals?.tokens_today ?? 0),
    auditsToday: Number(totals?.audits_today ?? 0),
    avgTokensPerAudit: totalAudits > 0 ? Math.round(totalTokens / totalAudits) : 0,
    estimatedSpend: Math.round(estimatedSpend * 100) / 100,
    cacheHitRate: cacheRequests > 0 ? Math.round((totalCacheHits / cacheRequests) * 1000) / 10 : 0,
    avgAuditDurationMs: Math.round(Number(duration?.avg_duration_ms ?? 0)),
    tokensOverTime: overTime.map((row) => ({
      date: row.date,
      tokens: Number(row.tokens),
      audits: Number(row.audits),
    })),
    tokensByModel,
    tokensByProvider: byProvider.map((row) => ({
      provider: row.provider,
      tokens: Number(row.tokens),
      audits: Number(row.audits),
      avgTokens: row.audits > 0 ? Math.round(Number(row.tokens) / Number(row.audits)) : 0,
    })),
    scoreDistribution: scoreDistribution.map((row) => ({
      range: row.range,
      audits: Number(row.audits),
    })),
    dailyActiveUsers: dailyActiveUsers.map((row) => ({
      date: row.date,
      users: Number(row.users),
    })),
    providerBudgetUtilization: providerBudget.map((row) => ({
      id: row.id,
      name: row.name,
      limit: Number(row.daily_limit),
      used: Number(row.used),
      pct: row.daily_limit > 0 ? Math.round((Number(row.used) / Number(row.daily_limit)) * 1000) / 10 : 0,
    })),
    topUsers: topUsers.map((row) => ({
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      auditsRun: Number(row.audits_run),
      tokensTotal: Number(row.tokens_total),
    })),
  };
}
