import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  getDb,
  saveDependencyTree,
  saveAuditReport,
  getAuditById,
  getAuditByUrl,
  getAuditReportById,
  getAuditReportByAuditId,
  getAuditReportByCacheKey,
  getDependenciesByAuditId,
} from "./db";
import { DbUnavailableError } from "./errors";

async function setupSchema(db: D1Database) {
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
  await db.exec(
    `CREATE TABLE IF NOT EXISTS package_dependencies (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `audit_id INTEGER NOT NULL,` +
      `name TEXT NOT NULL,` +
      `version TEXT NOT NULL,` +
      `dependency_type TEXT NOT NULL,` +
      `FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_reports (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `audit_id INTEGER NOT NULL,` +
      `prompt TEXT,` +
      `model TEXT NOT NULL,` +
      `score INTEGER NOT NULL,` +
      `result_json TEXT NOT NULL,` +
      `cache_key TEXT UNIQUE,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP,` +
      `FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE` +
      `);`,
  );
}

describe("db helpers", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupSchema(db);
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
  });

  it("getDb returns the binding from env", async () => {
    const result = await getDb(env as unknown as Record<string, unknown>);
    expect(result).toBe(db);
  });

  it("getDb throws DbUnavailableError when binding is missing", async () => {
    const emptyEnv = {} as Record<string, unknown>;
    await expect(getDb(emptyEnv)).rejects.toBeInstanceOf(DbUnavailableError);
  });

  it("saveDependencyTree inserts audit and dependencies", async () => {
    const auditId = await saveDependencyTree(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
    }, [
      { name: "dep-a", version: "1.0.0", dependency_type: "dependencies" },
    ]);

    expect(auditId).toBeGreaterThan(0);
    const deps = await getDependenciesByAuditId(db, auditId);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("dep-a");
  });

  it("saveDependencyTree works with no dependencies", async () => {
    const auditId = await saveDependencyTree(db, {
      name: "foo",
      version: "1.0.0",
      source: "github",
      url: "https://github.com/foo/bar",
    }, []);

    expect(auditId).toBeGreaterThan(0);
    const deps = await getDependenciesByAuditId(db, auditId);
    expect(deps).toHaveLength(0);
  });

  it("saveAuditReport inserts audit and report rows", async () => {
    const { auditId, reportId } = await saveAuditReport(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      prompt: "focus",
      model: "gpt-4o-mini",
      score: 85,
      resultJson: JSON.stringify({ score: 85 }),
      cacheKey: "abc123",
    });

    expect(auditId).toBeGreaterThan(0);
    expect(reportId).toBeGreaterThan(0);

    const audit = await getAuditById(db, auditId);
    expect(audit).not.toBeNull();
    expect(audit?.name).toBe("lodash");

    const byUrl = await getAuditByUrl(db, "https://www.npmjs.com/package/lodash");
    expect(byUrl?.id).toBe(auditId);

    const report = await getAuditReportById(db, reportId);
    expect(report).not.toBeNull();
    expect(report?.score).toBe(85);
    expect(report?.cache_key).toBe("abc123");

    const reportByAudit = await getAuditReportByAuditId(db, auditId);
    expect(reportByAudit?.id).toBe(reportId);

    const reportByCache = await getAuditReportByCacheKey(db, "abc123");
    expect(reportByCache?.id).toBe(reportId);
  });
});
