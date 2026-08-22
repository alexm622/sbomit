import { z } from "zod";
import { MissingInputError, AuditError, handleApiError } from "@/app/lib/errors";

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new MissingInputError("Invalid JSON body.");
  }
}

export function parseWithSchema<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  const first = parsed.error.issues[0];
  throw new MissingInputError(first?.message ?? "Invalid input.");
}

export function parseNumericId(value: string, name = "id"): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new MissingInputError(`Invalid ${name}.`);
  }
  return num;
}

export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof AuditError && error.retryAfter) {
        return Response.json(error.toJSON(), {
          status: error.status,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(error.retryAfter),
          },
        });
      }
      return handleApiError(error);
    }
  };
}
