import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimitBuckets } from "./rate-limit";

function makeRequest(ip: string): Request {
  return new Request("http://localhost/api/audit", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
  });

  it("allows requests under the limit", () => {
    const config = { maxRequests: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit(makeRequest("1.2.3.4"), config);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests over the limit", () => {
    const config = { maxRequests: 2, windowMs: 60_000 };
    checkRateLimit(makeRequest("1.2.3.4"), config);
    checkRateLimit(makeRequest("1.2.3.4"), config);
    const result = checkRateLimit(makeRequest("1.2.3.4"), config);
    expect(result.allowed).toBe(false);
  });

  it("tracks different IPs independently", () => {
    const config = { maxRequests: 1, windowMs: 60_000 };
    const a = checkRateLimit(makeRequest("1.2.3.4"), config);
    const b = checkRateLimit(makeRequest("5.6.7.8"), config);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it("reports remaining tokens", () => {
    const config = { maxRequests: 5, windowMs: 60_000 };
    const first = checkRateLimit(makeRequest("1.2.3.4"), config);
    expect(first.remaining).toBe(4);
  });

  it("uses cf-connecting-ip when x-forwarded-for is missing", () => {
    const request = new Request("http://localhost/api/audit", {
      headers: { "cf-connecting-ip": "9.9.9.9" },
    });
    const config = { maxRequests: 1, windowMs: 60_000 };
    expect(checkRateLimit(request, config).allowed).toBe(true);
  });
});
