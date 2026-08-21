import {
  runAudit,
  parseRequestBody,
  type AuditEvent,
  type RunAuditInput,
} from "@/app/lib/run-audit";
import { isAuditError } from "@/app/lib/errors";

function encodeEvent(event: AuditEvent): string {
  return JSON.stringify(event) + "\n";
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
        });
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
