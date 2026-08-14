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

export function checkRateLimit(
  request: Request,
  config: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 },
): { allowed: boolean; remaining: number; resetAt: number } {
  const ip = getClientIp(request);
  const key = `${ip}`;
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
