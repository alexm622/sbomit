import { AppError, handleApiError } from "@/app/lib/errors";
import { getDb, getReportByPublicId } from "@/app/lib/db";
import { auditResultSchema, type AuditResult } from "@/app/lib/audit";
import { checkRateLimit } from "@/app/lib/rate-limit";

const RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const { id } = await params;
    if (!id) {
      throw new AppError("BAD_REQUEST", "Report ID is required.", 400);
    }

    const db = await getDb();
    const report = await getReportByPublicId(db, id);
    if (!report) {
      throw new AppError("NOT_FOUND", "Report not found.", 404);
    }

    let result: AuditResult;
    try {
      result = auditResultSchema.parse(JSON.parse(report.result_json));
    } catch {
      throw new AppError(
        "INTERNAL_ERROR",
        "Stored report is corrupted.",
        500,
      );
    }

    return Response.json(
      {
        report: {
          id: report.public_id,
          model: report.model,
          score: report.score,
          createdAt: report.created_at,
          result,
        },
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
