import { runAudit, parseRequestBody } from "@/app/lib/run-audit";
import { RateLimitExceededError } from "@/app/lib/errors";
import { getDb } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import {
  checkRateLimit,
  DEFAULT_RATE_LIMIT,
} from "@/app/lib/rate-limit";
import { parseJsonBody, withErrorHandling } from "@/app/lib/api";
import { checkProviderBudget, finalizeProviderUsage } from "@/app/lib/provider-budget";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ?? "anonymous";
}

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);
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

  await finalizeProviderUsage(db, input.providerId, meta);

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
});
