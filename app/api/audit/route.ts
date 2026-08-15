import { runAudit, parseRequestBody } from "@/app/lib/run-audit";
import { isAuditError } from "@/app/lib/errors";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const { MissingInputError } = await import("@/app/lib/errors");
      throw new MissingInputError("Invalid JSON body.");
    }

    const { libraryUrl, prompt } = parseRequestBody(body);

    const { result, meta } = await runAudit({ libraryUrl, prompt });

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
