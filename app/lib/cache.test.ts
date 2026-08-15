import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { getCachedAuditReport, isCacheExpired, isVersionPinned } from "./cache";
import type { StoredAuditReport } from "./db";

async function setupSchema(db: D1Database) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_reports (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `audit_id INTEGER NOT NULL,` +
      `public_id TEXT NOT NULL UNIQUE,` +
      `prompt TEXT,` +
      `model TEXT NOT NULL,` +
      `score INTEGER NOT NULL,` +
      `result_json TEXT NOT NULL,` +
      `cache_key TEXT UNIQUE,` +
      `interaction_json TEXT,` +
      `codebase_inspected INTEGER DEFAULT 0,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP,` +
      `FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS package_audits (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `name TEXT NOT NULL,` +
      `version TEXT NOT NULL,` +
      `source TEXT NOT NULL,` +
      `url TEXT NOT NULL,` +
      `audited_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
      `);`,
  );
}

describe("cache helpers", () => {
  it("detects pinned semver versions", () => {
    expect(isVersionPinned("4.17.21")).toBe(true);
    expect(isVersionPinned("1.0.0-alpha")).toBe(true);
    expect(isVersionPinned("latest")).toBe(false);
    expect(isVersionPinned("main")).toBe(false);
  });

  it("never expires pinned versions", () => {
    const report = { created_at: "2020-01-01T00:00:00.000Z" } as StoredAuditReport;
    expect(isCacheExpired(report, "4.17.21")).toBe(false);
  });

  it("expires mutable versions after 24 hours", () => {
    const old = { created_at: "2020-01-01T00:00:00.000Z" } as StoredAuditReport;
    expect(isCacheExpired(old, "latest")).toBe(true);

    const recent = { created_at: new Date().toISOString() } as StoredAuditReport;
    expect(isCacheExpired(recent, "latest")).toBe(false);
  });
});

describe("getCachedAuditReport", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupSchema(db);
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
  });

  async function seedReport(
    cacheKey: string,
    version: string,
    createdAt: string,
  ): Promise<void> {
    const auditResult = await db
      .prepare(
        "INSERT INTO package_audits (name, version, source, url) VALUES (?, ?, ?, ?)",
      )
      .bind("pkg", version, "npm", "https://www.npmjs.com/package/pkg")
      .run<{ id: number }>();
    const auditId = auditResult.meta?.last_row_id as number;
    await db
      .prepare(
        "INSERT INTO audit_reports (audit_id, public_id, model, score, result_json, cache_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        auditId,
        cacheKey,
        "gpt-4o-mini",
        80,
        "{}",
        cacheKey,
        createdAt,
      )
      .run();
  }

  it("returns a fresh cached report for pinned versions", async () => {
    await seedReport("key-1", "1.2.3", "2020-01-01T00:00:00.000Z");
    const report = await getCachedAuditReport(db, "key-1", "1.2.3");
    expect(report).not.toBeNull();
    expect(report?.cache_key).toBe("key-1");
  });

  it("returns null and deletes expired reports for latest versions", async () => {
    await seedReport("key-2", "latest", "2020-01-01T00:00:00.000Z");
    const report = await getCachedAuditReport(db, "key-2", "latest");
    expect(report).toBeNull();

    const remaining = await db
      .prepare("SELECT COUNT(*) as count FROM audit_reports WHERE cache_key = ?")
      .bind("key-2")
      .first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });

  it("returns null when no report matches", async () => {
    const report = await getCachedAuditReport(db, "missing", "1.0.0");
    expect(report).toBeNull();
  });
});
