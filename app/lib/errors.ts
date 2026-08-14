export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: AppError): Response {
  const body: ApiErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
  return Response.json(body, { status: error.status });
}

export function handleUpstreamError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : "Unknown error";
  const lower = message.toLowerCase();

  if (lower.includes("not found") || lower.includes("404")) {
    return new AppError("NOT_FOUND", message, 404);
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return new AppError("UPSTREAM_ERROR", "Upstream rate limit hit. Try again later.", 502);
  }
  if (lower.includes("openai") || lower.includes("ai")) {
    return new AppError("UPSTREAM_ERROR", "AI audit service failed. Try again later.", 502);
  }

  return new AppError("UPSTREAM_ERROR", message, 502);
}

export function handleApiError(error: unknown): Response {
  if (error instanceof AppError) {
    return errorResponse(error);
  }

  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return errorResponse(new AppError("INTERNAL_ERROR", message, 500));
}
