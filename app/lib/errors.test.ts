import { describe, it, expect } from "vitest";
import {
  AppError,
  errorResponse,
  handleApiError,
  handleUpstreamError,
} from "./errors";

describe("AppError", () => {
  it("stores code, message, and status", () => {
    const err = new AppError("NOT_FOUND", "Missing", 404, { id: 1 });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Missing");
    expect(err.status).toBe(404);
    expect(err.details).toEqual({ id: 1 });
  });
});

describe("errorResponse", () => {
  it("returns a JSON response with error details", async () => {
    const response = errorResponse(new AppError("BAD_REQUEST", "Invalid", 400));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});

describe("handleUpstreamError", () => {
  it("passes through AppError instances", () => {
    const err = new AppError("RATE_LIMITED", "Slow down", 429);
    expect(handleUpstreamError(err)).toBe(err);
  });

  it("maps not-found messages to 404", () => {
    const err = handleUpstreamError(new Error("npm package not found: foo"));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
  });

  it("maps rate-limit messages to upstream errors", () => {
    const err = handleUpstreamError(new Error("GitHub rate limit exceeded"));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.status).toBe(502);
  });

  it("maps OpenAI failures to upstream errors", () => {
    const err = handleUpstreamError(new Error("OpenAI timeout"));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.status).toBe(502);
  });
});

describe("handleApiError", () => {
  it("returns the correct status for known errors", async () => {
    const response = handleApiError(new AppError("NOT_FOUND", "Nope", 404));
    expect(response.status).toBe(404);
  });

  it("returns 500 for unknown errors", async () => {
    const response = handleApiError("boom");
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
