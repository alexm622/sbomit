export interface RateLimitState {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export function resetRateLimitBuckets(): void {
  buckets.clear();
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("cf-connecting-ip") || "unknown";
}

/**
 * Token-bucket-style rate limiter backed by D1.
 *
 * Counts requests per identifier per time window. Windows are fixed buckets
 * (e.g. the current hour), so resets are predictable. The counter is created
 * lazily and incremented atomically with INSERT ... ON CONFLICT.
 */
export async function checkRateLimit(
  db: D1Database,
  identifier: string,
  limit: number,
  windowMinutes: number,
): Promise<RateLimitState>;

export function checkRateLimit(
  request: Request,
  config?: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number };

export function checkRateLimit(
  dbOrRequest: D1Database | Request,
  identifierOrConfig: string | RateLimitConfig | undefined,
  limit?: number,
  windowMinutes?: number,
): Promise<RateLimitState> | { allowed: boolean; remaining: number; resetAt: number } {
  if (dbOrRequest instanceof Request) {
    const config: RateLimitConfig = (identifierOrConfig as RateLimitConfig | undefined) ?? {
      maxRequests: 10,
      windowMs: 60_000,
    };
    const ip = getClientIp(dbOrRequest);
    const key = ip;
    const now = Date.now();

    const bucket = buckets.get(key);
    const tokens = bucket
      ? Math.min(
          config.maxRequests,
          bucket.tokens +
            ((now - bucket.lastRefill) / config.windowMs) * config.maxRequests,
        )
      : config.maxRequests;

    const newBucket: Bucket = {
      tokens: Math.max(0, tokens - 1),
      lastRefill: now,
    };

    buckets.set(key, newBucket);

    const resetAt = Math.ceil((now + config.windowMs) / 1000);

    return {
      allowed: tokens >= 1,
      remaining: Math.floor(newBucket.tokens),
      resetAt,
    };
  }

  const db = dbOrRequest;
  const identifier = identifierOrConfig as string;
  const resolvedLimit = limit!;
  const resolvedWindowMinutes = windowMinutes!;

  const now = Date.now();
  const windowMs = resolvedWindowMinutes * 60 * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  const result = db
    .prepare(
      `INSERT INTO rate_limits (identifier, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(identifier, window_start) DO UPDATE SET count = count + 1`,
    )
    .bind(identifier, windowStart)
    .run()
    .then(async () => {
      const row = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE identifier = ? AND window_start = ?",
        )
        .bind(identifier, windowStart)
        .first<{ count: number }>();

      const count = row?.count ?? 1;
      const remaining = Math.max(0, resolvedLimit - count);

      return {
        allowed: count <= resolvedLimit,
        limit: resolvedLimit,
        remaining,
        resetAt,
      };
    });

  return result;
}

/**
 * Default limits for anonymous audit requests.
 */
export const DEFAULT_RATE_LIMIT = {
  limit: 10,
  windowMinutes: 60,
};
