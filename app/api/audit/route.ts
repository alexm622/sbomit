import { resolveLibrary, computeCacheKey, type AuditResult } from "@/app/lib/audit";
import {
  getDb,
  saveAuditReport,
  getAuditReportByCacheKey,
  type StoredAuditReport,
} from "@/app/lib/db";
import { getLlmConfig, runLibraryAudit, type LlmInteraction } from "@/app/lib/llm";
import { resolveCodebase } from "@/app/lib/audit";
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

function storedReportToInteractions(
  report: StoredAuditReport,
): LlmInteraction[] | undefined {
  if (!report.interaction_json) return undefined;
  const parsed = JSON.parse(report.interaction_json) as
    | LlmInteraction
    | LlmInteraction[];
  return Array.isArray(parsed) ? parsed : [parsed];
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
    let context = await resolveLibrary(libraryUrl);
    const codebase = await resolveCodebase(context);
    const codebaseInspected = !!codebase && codebase.files.length > 0;
    if (codebase) {
      context = { ...context, codebase };
    }
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
            codebaseInspected: cached.codebase_inspected === 1,
            interactions: storedReportToInteractions(cached),
          },
        },
        { status: 200 },
      );
    }

    const { result, interactions } = await runLibraryAudit(context, prompt);
    const resultJson = JSON.stringify(result);
    const interactionJson = JSON.stringify(interactions);
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
      interactionJson,
      codebaseInspected,
    });

    return Response.json(
      {
        result,
        meta: {
          cached: false,
          auditId,
          reportId,
          codebaseInspected,
          interactions,
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
