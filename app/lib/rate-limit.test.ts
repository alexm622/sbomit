import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { checkRateLimit } from "./rate-limit";

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
