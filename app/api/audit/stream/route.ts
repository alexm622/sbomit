import {
  runAudit,
  parseRequestBody,
  type AuditEvent,
  type RunAuditInput,
} from "@/app/lib/run-audit";
import { AuditError } from "@/app/lib/errors";
import { getDb } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import { parseJsonBody, withErrorHandling } from "@/app/lib/api";
import { checkProviderBudget, finalizeProviderUsage } from "@/app/lib/provider-budget";

function encodeEvent(event: AuditEvent): string {
  return JSON.stringify(event) + "\n";
}

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);
  const input: RunAuditInput = parseRequestBody(body);

  const db = await getDb();
  const user = await requireAuth(db, request);
  input.userId = user.id;
  await checkProviderBudget(db, input.providerId);

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

        await finalizeProviderUsage(db, input.providerId, meta);

        sendComplete(result, meta);
      } catch (error) {
        if (error instanceof AuditError) {
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
});
