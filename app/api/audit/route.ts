import {
  enrichLibraryContext,
  normalizeLibraryUrl,
  resolveLibrary,
  type AuditResult,
} from "@/app/lib/audit";
import { AppError, handleApiError } from "@/app/lib/errors";
import {
  getDb,
  getRecentReportByUrl,
  saveDependencyTree,
  saveReport,
} from "@/app/lib/db";
import { runLibraryAudit } from "@/app/lib/openai";
import { checkRateLimit } from "@/app/lib/rate-limit";
import { z } from "zod";

const auditRequestSchema = z.object({
  libraryUrl: z.string().min(1, "libraryUrl is required"),
  prompt: z.string().optional(),
});

const RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };
const CACHE_TTL_HOURS = 24;

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

    const parsed = auditRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "BAD_REQUEST",
        parsed.error.issues.map((e) => e.message).join("; "),
        400,
      );
    }

    const libraryUrl = normalizeLibraryUrl(parsed.data.libraryUrl.trim());
    const db = await getDb();

    const cached = await getRecentReportByUrl(db, libraryUrl, CACHE_TTL_HOURS);
    if (cached) {
      const result = JSON.parse(cached.result_json) as AuditResult;
      return Response.json(
        {
          result,
          reportId: cached.public_id,
          cached: true,
        },
        {
          headers: {
            "X-RateLimit-Limit": String(RATE_LIMIT.maxRequests),
            "X-RateLimit-Remaining": String(rateLimit.remaining),
            "X-RateLimit-Reset": String(rateLimit.resetAt),
          },
        },
      );
    }

    const context = await resolveLibrary(libraryUrl);
    const enriched = await enrichLibraryContext(context);
    const result = await runLibraryAudit(enriched, parsed.data.prompt);

    // Persist package audit + dependency tree + report.
    const dependencies: Array<{
      name: string;
      version: string;
      dependency_type: string;
    }> = [];
    if (context.source === "npm") {
      const metadata = context.metadata as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      for (const [name, version] of Object.entries(metadata.dependencies || {})) {
        dependencies.push({ name, version, dependency_type: "dependencies" });
      }
      for (const [name, version] of Object.entries(metadata.devDependencies || {})) {
        dependencies.push({ name, version, dependency_type: "devDependencies" });
      }
      for (const [name, version] of Object.entries(metadata.peerDependencies || {})) {
        dependencies.push({ name, version, dependency_type: "peerDependencies" });
      }
      for (const [name, version] of Object.entries(metadata.optionalDependencies || {})) {
        dependencies.push({ name, version, dependency_type: "optionalDependencies" });
      }
    }

    const auditId = await saveDependencyTree(
      db,
      {
        name: context.name,
        version: context.version,
        source: context.source,
        url: context.url,
      },
      dependencies,
    );

    const publicId = crypto.randomUUID();
    await saveReport(db, auditId, {
      publicId,
      prompt: parsed.data.prompt,
      model: "gpt-4o-mini",
      score: result.score,
      resultJson: JSON.stringify(result),
    });

    return Response.json(
      { result, reportId: publicId, cached: false },
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
