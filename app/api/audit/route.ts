import { runAudit, parseRequestBody } from "@/app/lib/run-audit";
import { isAuditError, RateLimitExceededError } from "@/app/lib/errors";
import { getDb } from "@/app/lib/db";
import {
  checkRateLimit,
  DEFAULT_RATE_LIMIT,
} from "@/app/lib/rate-limit";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ?? "anonymous";
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
    const rateLimit = await checkRateLimit(
      db,
      getClientIp(request),
      DEFAULT_RATE_LIMIT.limit,
      DEFAULT_RATE_LIMIT.windowMinutes,
    );
    if (!rateLimit.allowed) {
      throw new RateLimitExceededError(rateLimit.limit, rateLimit.resetAt);
    }

    const { result, meta } = await runAudit(input, undefined, db);

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
