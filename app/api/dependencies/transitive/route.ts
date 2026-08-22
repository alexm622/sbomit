import { resolveTransitiveDependencies } from "@/app/lib/dependencies";
import { checkRateLimit } from "@/app/lib/rate-limit";
import { AuditError } from "@/app/lib/errors";
import { z } from "zod";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const requestSchema = z.object({
  libraryUrl: z.string().min(1, "libraryUrl is required"),
  maxDepth: z.number().int().min(1).max(3).optional(),
  includeDev: z.boolean().optional(),
});

const RATE_LIMIT = { maxRequests: 15, windowMs: 60_000 };

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const rateLimit = checkRateLimit(request, RATE_LIMIT);
  if (!rateLimit.allowed) {
    throw new AuditError(
      "RATE_LIMIT_EXCEEDED",
      "Too many requests. Please slow down.",
      429,
      rateLimit.resetAt,
    );
  }

  const body = await parseJsonBody(request);
  const parsed = parseWithSchema(requestSchema, body);

  const dependencies = await resolveTransitiveDependencies(
    parsed.libraryUrl,
    {
      maxDepth: parsed.maxDepth,
      includeDev: parsed.includeDev,
    },
  );

  return Response.json(
    {
      dependencies,
      count: dependencies.length,
    },
    {
      headers: {
        "X-RateLimit-Limit": String(RATE_LIMIT.maxRequests),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-RateLimit-Reset": String(rateLimit.resetAt),
      },
    },
  );
});
