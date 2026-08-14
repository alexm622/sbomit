export type ErrorCode =
  | "MISSING_INPUT"
  | "UNSUPPORTED_SOURCE"
  | "PACKAGE_NOT_FOUND"
  | "REPO_NOT_FOUND"
  | "UPSTREAM_RATE_LIMIT"
  | "AUDIT_PARSE_ERROR"
  | "DB_UNAVAILABLE"
  | "INTERNAL_ERROR";

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
