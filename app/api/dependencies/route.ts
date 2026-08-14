import {
  normalizeLibraryUrl,
  resolveLibrary,
  type LibraryContext,
} from "@/app/lib/audit";
import { AppError, handleApiError } from "@/app/lib/errors";
import {
  getDb,
  saveDependencyTree,
  type StoredDependency,
} from "@/app/lib/db";
import { checkRateLimit } from "@/app/lib/rate-limit";
import { z } from "zod";

interface DependencyTreeResponse {
  auditId: number;
  name: string;
  version: string;
  source: string;
  url: string;
  dependencies: StoredDependency[];
}

const dependencyRequestSchema = z.object({
  libraryUrl: z.string().min(1, "libraryUrl is required"),
});

const RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };

function extractDependencies(context: LibraryContext): StoredDependency[] {
  const deps: StoredDependency[] = [];

  if (context.source === "npm") {
    const metadata = context.metadata as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    for (const [name, version] of Object.entries(metadata.dependencies || {})) {
      deps.push({ name, version, dependency_type: "dependencies" });
    }
    for (const [name, version] of Object.entries(
      metadata.devDependencies || {},
    )) {
      deps.push({ name, version, dependency_type: "devDependencies" });
    }
    for (const [name, version] of Object.entries(
      metadata.peerDependencies || {},
    )) {
      deps.push({ name, version, dependency_type: "peerDependencies" });
    }
    for (const [name, version] of Object.entries(
      metadata.optionalDependencies || {},
    )) {
      deps.push({ name, version, dependency_type: "optionalDependencies" });
    }
  }

  // GitHub repos don't publish dependency manifests via the basic repo API,
  // so we store an empty direct-dependency list for that source.

  return deps;
}

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

    const parsed = dependencyRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "BAD_REQUEST",
        parsed.error.issues.map((e) => e.message).join("; "),
        400,
      );
    }

    const libraryUrl = normalizeLibraryUrl(parsed.data.libraryUrl.trim());

    const db = await getDb();
    const context = await resolveLibrary(libraryUrl);
    const dependencies = extractDependencies(context);

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

    const response: DependencyTreeResponse = {
      auditId,
      name: context.name,
      version: context.version,
      source: context.source,
      url: context.url,
      dependencies,
    };

    return Response.json(response, {
      headers: {
        "X-RateLimit-Limit": String(RATE_LIMIT.maxRequests),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-RateLimit-Reset": String(rateLimit.resetAt),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
