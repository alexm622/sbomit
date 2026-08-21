import {
  runAudit,
  parseRequestBody,
  type AuditEvent,
  type RunAuditInput,
} from "@/app/lib/run-audit";
import { isAuditError, AuditError } from "@/app/lib/errors";
import { getDb, getProviderLimit, getProviderUsage, recordProviderUsage, incrementCacheHits } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";

function encodeEvent(event: AuditEvent): string {
  return JSON.stringify(event) + "\n";
}

async function checkProviderBudget(
  db: D1Database,
  providerId: string | undefined,
  tokensEstimate = 0,
): Promise<void> {
  if (!providerId) return;
  const limit = await getProviderLimit(db, providerId);
  if (limit?.daily_token_limit == null) return;
  const used = await getProviderUsage(db, providerId);
  if (used + tokensEstimate >= limit.daily_token_limit) {
    throw new AuditError(
      "RATE_LIMIT_EXCEEDED",
      `Provider daily token limit reached (${limit.daily_token_limit}).`,
      429,
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body.", code: "MISSING_INPUT" },
      { status: 400 },
    );
  }

  let input: RunAuditInput;
  try {
    input = parseRequestBody(body);
  } catch (error) {
    if (isAuditError(error)) {
      return Response.json(error.toJSON(), { status: error.status });
    }
    return Response.json(
      { error: "Invalid request.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }

  let db: D1Database;
  try {
    db = await getDb();
    const user = await requireAuth(db, request);
    input.userId = user.id;
    await checkProviderBudget(db, input.providerId);
  } catch (error) {
    if (isAuditError(error)) {
      return Response.json(error.toJSON(), { status: error.status });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Authentication failed.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: AuditEvent): void {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      }

      function sendComplete(result: unknown, meta: unknown): void {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "complete", result, meta }) + "\n",
          ),
        );
        controller.close();
      }

      function sendError(error: unknown): void {
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "error", error }) + "\n"),
        );
        controller.close();
      }

      try {
        const { result, meta } = await runAudit(input, (event) => {
          send(event);
        }, db);

        if (meta.cached) {
          await incrementCacheHits(db, meta.reportId);
        }

        if (!meta.cached && input.providerId && meta.interactions.length > 0) {
          const totalTokens = meta.interactions.reduce(
            (sum, i) => sum + (i.tokensInput ?? 0) + (i.tokensOutput ?? 0),
            0,
          );
          if (totalTokens > 0) {
            await recordProviderUsage(db, input.providerId, totalTokens);
          }
        }

        sendComplete(result, meta);
      } catch (error) {
        if (isAuditError(error)) {
          sendError({
            error: error.message,
            code: error.code,
            retryAfter: error.retryAfter,
          });
        } else {
          const message =
            error instanceof Error
              ? error.message
              : "An unexpected error occurred.";
          sendError({ error: message, code: "INTERNAL_ERROR" });
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
