import { AppError, handleApiError } from "@/app/lib/errors";
import { resolveTransitiveDependencies } from "@/app/lib/dependencies";
import { checkRateLimit } from "@/app/lib/rate-limit";
import { z } from "zod";

const requestSchema = z.object({
  libraryUrl: z.string().min(1, "libraryUrl is required"),
  maxDepth: z.number().int().min(1).max(3).optional(),
  includeDev: z.boolean().optional(),
});

const RATE_LIMIT = { maxRequests: 15, windowMs: 60_000 };

export async function POST(request: Request) {
  try {
    const rateLimit = checkRateLimit(request, RATE_LIMIT);
    if (!rateLimit.allowed) {
      return Response.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please slow down.",
          },
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(RATE_LIMIT.maxRequests),
            "X-RateLimit-Remaining": String(rateLimit.remaining),
            "X-RateLimit-Reset": String(rateLimit.resetAt),
          },
        },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "BAD_REQUEST",
        parsed.error.issues.map((e) => e.message).join("; "),
        400,
      );
    }

    const dependencies = await resolveTransitiveDependencies(
      parsed.data.libraryUrl,
      {
        maxDepth: parsed.data.maxDepth,
        includeDev: parsed.data.includeDev,
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
  } catch (error) {
    return handleApiError(error);
  }
}
