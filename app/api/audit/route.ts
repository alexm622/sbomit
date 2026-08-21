import { runAudit, parseRequestBody } from "@/app/lib/run-audit";
import { isAuditError, RateLimitExceededError, AuditError } from "@/app/lib/errors";
import { getDb, getProviderLimit, getProviderUsage, recordProviderUsage, incrementCacheHits } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import {
  checkRateLimit,
  DEFAULT_RATE_LIMIT,
} from "@/app/lib/rate-limit";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ?? "anonymous";
}

async function checkProviderBudget(
  db: D1Database,
  providerId: string | undefined,
  tokensEstimate = 0,
): Promise<void> {
  if (!providerId) return;
  const limit = await getProviderLimit(db, providerId);
  if (limit?.daily_token_limit == null) return;
  const used = await getProviderUsage(db, providerId);
  if (used + tokensEstimate >= limit.daily_token_limit) {
    throw new AuditError(
      "RATE_LIMIT_EXCEEDED",
      `Provider daily token limit reached (${limit.daily_token_limit}).`,
      429,
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const { MissingInputError } = await import("@/app/lib/errors");
      throw new MissingInputError("Invalid JSON body.");
    }

    const input = parseRequestBody(body);

    const db = await getDb();
    const user = await requireAuth(db, request);
    input.userId = user.id;

    const rateLimit = await checkRateLimit(
      db,
      getClientIp(request),
      DEFAULT_RATE_LIMIT.limit,
      DEFAULT_RATE_LIMIT.windowMinutes,
    );
    if (!rateLimit.allowed) {
      throw new RateLimitExceededError(rateLimit.limit, rateLimit.resetAt);
    }

    await checkProviderBudget(db, input.providerId);

    const { result, meta } = await runAudit(input, undefined, db);

    if (meta.cached) {
      await incrementCacheHits(db, meta.reportId);
    }

    if (!meta.cached && input.providerId && meta.interactions.length > 0) {
      const totalTokens = meta.interactions.reduce(
        (sum, i) => sum + (i.tokensInput ?? 0) + (i.tokensOutput ?? 0),
        0,
      );
      if (totalTokens > 0) {
        await recordProviderUsage(db, input.providerId, totalTokens);
      }
    }

    return Response.json(
      {
        result,
        meta: {
          ...meta,
          cached: meta.cached,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (isAuditError(error)) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (error.retryAfter) {
        headers["Retry-After"] = String(error.retryAfter);
      }
      return Response.json(error.toJSON(), {
        status: error.status,
        headers,
      });
    }

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return Response.json(
      {
        error: message,
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}
