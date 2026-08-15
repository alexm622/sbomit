export type ErrorCode =
  | "MISSING_INPUT"
  | "UNSUPPORTED_SOURCE"
  | "PACKAGE_NOT_FOUND"
  | "REPO_NOT_FOUND"
  | "REPORT_NOT_FOUND"
  | "UPSTREAM_RATE_LIMIT"
  | "RATE_LIMIT_EXCEEDED"
  | "AUDIT_PARSE_ERROR"
  | "DB_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR";

export class AuditError extends Error {
  code: ErrorCode;
  status: number;
  retryAfter?: number;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "AuditError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.retryAfter ? { retryAfter: this.retryAfter } : {}),
    };
  }
}

export class MissingInputError extends AuditError {
  constructor(message = "libraryUrl is required.") {
    super("MISSING_INPUT", message, 400);
  }
}

export class UnsupportedSourceError extends AuditError {
  constructor(
    message = "Unsupported library URL. Provide an npm package URL or GitHub repository URL.",
  ) {
    super("UNSUPPORTED_SOURCE", message, 422);
  }
}

export class PackageNotFoundError extends AuditError {
  constructor(name: string) {
    super("PACKAGE_NOT_FOUND", `npm package not found: ${name}`, 404);
  }
}

export class RepoNotFoundError extends AuditError {
  constructor(owner: string, repo: string) {
    super(
      "REPO_NOT_FOUND",
      `GitHub repository not found or private: ${owner}/${repo}`,
      404,
    );
  }
}

export class ReportNotFoundError extends AuditError {
  constructor(id: string | number) {
    super("REPORT_NOT_FOUND", `Audit report not found: ${id}`, 404);
  }
}

export class UpstreamRateLimitError extends AuditError {
  constructor(service: string, retryAfter?: number) {
    super(
      "UPSTREAM_RATE_LIMIT",
      `${service} rate limit exceeded. Please retry later.`,
      429,
      retryAfter,
    );
  }
}

export class RateLimitExceededError extends AuditError {
  constructor(limit: number, resetAt?: number) {
    const retryAfter = resetAt
      ? Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))
      : undefined;
    super(
      "RATE_LIMIT_EXCEEDED",
      `Rate limit exceeded. Limit: ${limit} audits per hour. Please retry later.`,
      429,
      retryAfter,
    );
  }
}

export class AuditParseError extends AuditError {
  constructor(message = "Failed to parse the audit result.") {
    super("AUDIT_PARSE_ERROR", message, 502);
  }
}

export class DbUnavailableError extends AuditError {
  constructor(
    message = "Database binding (DB) is not available. Check your Wrangler configuration.",
  ) {
    super("DB_UNAVAILABLE", message, 500);
  }
}

export function isAuditError(error: unknown): error is AuditError {
  return error instanceof AuditError;
}

export { AuditError as AppError };

export function errorResponse(error: AuditError): Response {
  return Response.json(
    { error: error.message, code: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) },
    { status: error.status },
  );
}

export function handleApiError(error: unknown): Response {
  if (error instanceof AuditError) {
    return errorResponse(error);
  }

  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return errorResponse(new AuditError("INTERNAL_ERROR", message, 500));
}
