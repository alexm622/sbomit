import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { checkRateLimit, resetRateLimitBuckets } from "./rate-limit";

async function setupSchema(db: D1Database) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS rate_limits (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `identifier TEXT NOT NULL,` +
      `window_start INTEGER NOT NULL,` +
      `count INTEGER NOT NULL DEFAULT 0,` +
      `UNIQUE(identifier, window_start)` +
      `);`,
  );
}

describe("checkRateLimit", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupSchema(db);
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
  });

  it("allows requests under the limit", async () => {
    const state = await checkRateLimit(db, "ip-1", 3, 60);
    expect(state.allowed).toBe(true);
    expect(state.remaining).toBe(2);
  });

  it("blocks requests over the limit", async () => {
    await checkRateLimit(db, "ip-2", 2, 60);
    await checkRateLimit(db, "ip-2", 2, 60);
    const state = await checkRateLimit(db, "ip-2", 2, 60);
    expect(state.allowed).toBe(false);
    expect(state.remaining).toBe(0);
  });

  it("resets counters in a new time window", async () => {
    // Use a tiny window so the next call lands in a new bucket.
    const state1 = await checkRateLimit(db, "ip-3", 1, 0.00005);
    expect(state1.allowed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const state2 = await checkRateLimit(db, "ip-3", 1, 0.00005);
    expect(state2.allowed).toBe(true);
  });
});

describe("checkRateLimit(request)", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
  });

  function makeRequest(ip: string): Request {
    return new Request("http://localhost/api/audit", {
      headers: { "x-forwarded-for": ip },
    });
  }

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
