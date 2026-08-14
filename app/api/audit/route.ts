import { resolveLibrary, computeCacheKey, type AuditResult } from "@/app/lib/audit";
import {
  getDb,
  saveAuditReport,
  getAuditReportByCacheKey,
  type StoredAuditReport,
} from "@/app/lib/db";
import { getLlmConfig, runLibraryAudit } from "@/app/lib/llm";
import {
  MissingInputError,
  isAuditError,
} from "@/app/lib/errors";

function parseRequestBody(body: unknown): { libraryUrl: string; prompt?: string } {
  if (!body || typeof body !== "object") {
    throw new MissingInputError();
  }
  const { libraryUrl, prompt } = body as {
    libraryUrl?: unknown;
    prompt?: unknown;
  };
  if (typeof libraryUrl !== "string" || libraryUrl.trim().length === 0) {
    throw new MissingInputError();
  }
  return {
    libraryUrl: libraryUrl.trim(),
    prompt: typeof prompt === "string" ? prompt : undefined,
  };
}

function storedReportToResult(report: StoredAuditReport): AuditResult {
  return JSON.parse(report.result_json) as AuditResult;
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const { libraryUrl, prompt } = parseRequestBody(body);
    const db = await getDb();
    const context = await resolveLibrary(libraryUrl);
    const cacheKey = await computeCacheKey(context, prompt);

    // Cache check: return a stored report for identical inputs.
    const cached = await getAuditReportByCacheKey(db, cacheKey);
    if (cached) {
      const result = storedReportToResult(cached);
      return Response.json(
        {
          result,
          meta: {
            cached: true,
            auditId: cached.audit_id,
            reportId: cached.id,
          },
        },
        { status: 200 },
      );
    }

    const result = await runLibraryAudit(context, prompt);
    const resultJson = JSON.stringify(result);
    const { model } = getLlmConfig();

    const { auditId, reportId } = await saveAuditReport(db, {
      name: result.name,
      version: result.version,
      source: context.source,
      url: context.url,
      prompt,
      model,
      score: result.score,
      resultJson,
      cacheKey,
    });

    return Response.json(
      {
        result,
        meta: {
          cached: false,
          auditId,
          reportId,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (isAuditError(error)) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
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
