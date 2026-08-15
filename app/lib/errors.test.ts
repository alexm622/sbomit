import { describe, it, expect } from "vitest";
import {
  AuditError,
  MissingInputError,
  UnsupportedSourceError,
  PackageNotFoundError,
  RepoNotFoundError,
  UpstreamRateLimitError,
  AuditParseError,
  DbUnavailableError,
  isAuditError,
} from "./errors";

describe("errors", () => {
  it("AuditError serializes to JSON with code and message", () => {
    const error = new AuditError("INTERNAL_ERROR", "oops", 500);
    expect(error.toJSON()).toEqual({ error: "oops", code: "INTERNAL_ERROR" });
    expect(error.status).toBe(500);
  });

  it("AuditError includes retryAfter when provided", () => {
    const error = new AuditError("UPSTREAM_RATE_LIMIT", "slow down", 429, 120);
    expect(error.toJSON()).toEqual({
      error: "slow down",
      code: "UPSTREAM_RATE_LIMIT",
      retryAfter: 120,
    });
  });

  it.each([
    [new MissingInputError(), 400, "MISSING_INPUT"],
    [new UnsupportedSourceError(), 422, "UNSUPPORTED_SOURCE"],
    [new PackageNotFoundError("lodash"), 404, "PACKAGE_NOT_FOUND"],
    [new RepoNotFoundError("facebook", "react"), 404, "REPO_NOT_FOUND"],
    [new UpstreamRateLimitError("GitHub API"), 429, "UPSTREAM_RATE_LIMIT"],
    [new AuditParseError(), 502, "AUDIT_PARSE_ERROR"],
    [new DbUnavailableError(), 500, "DB_UNAVAILABLE"],
  ])("%# maps error to expected status/code", (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(isAuditError(error)).toBe(true);
  });

  it("isAuditError returns false for plain errors", () => {
    expect(isAuditError(new Error("plain"))).toBe(false);
    expect(isAuditError("string")).toBe(false);
    expect(isAuditError(null)).toBe(false);
  });
});
