export interface RateLimitState {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
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
): Promise<RateLimitState> {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  await db
    .prepare(
      `INSERT INTO rate_limits (identifier, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(identifier, window_start) DO UPDATE SET count = count + 1`,
    )
    .bind(identifier, windowStart)
    .run();

  const row = await db
    .prepare(
      "SELECT count FROM rate_limits WHERE identifier = ? AND window_start = ?",
    )
    .bind(identifier, windowStart)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  const remaining = Math.max(0, limit - count);

  return {
    allowed: count <= limit,
    limit,
    remaining,
    resetAt,
  };
}

/**
 * Default limits for anonymous audit requests.
 */
export const DEFAULT_RATE_LIMIT = {
  limit: 10,
  windowMinutes: 60,
};
