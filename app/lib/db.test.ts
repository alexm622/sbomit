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
  listAuditReports,
  deleteAuditReport,
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

  it("listAuditReports returns report summaries newest first", async () => {
    const first = await saveAuditReport(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      model: "gpt-4o-mini",
      score: 85,
      resultJson: JSON.stringify({ score: 85 }),
    });
    const second = await saveAuditReport(db, {
      name: "react",
      version: "latest",
      source: "github",
      url: "https://github.com/facebook/react",
      prompt: "focus on license",
      model: "gpt-4o-mini",
      score: 92,
      resultJson: JSON.stringify({ score: 92 }),
    });

    const reports = await listAuditReports(db);
    expect(reports).toHaveLength(2);
    expect(reports[0].id).toBe(second.reportId);
    expect(reports[0].name).toBe("react");
    expect(reports[0].source).toBe("github");
    expect(reports[0].prompt).toBe("focus on license");
    expect(reports[0].score).toBe(92);
    expect(reports[1].id).toBe(first.reportId);
    expect(reports[1].name).toBe("lodash");
  });

  it("listAuditReports respects the limit", async () => {
    await saveAuditReport(db, {
      name: "a",
      version: "1.0.0",
      source: "npm",
      url: "https://www.npmjs.com/package/a",
      model: "gpt-4o-mini",
      score: 50,
      resultJson: "{}",
    });
    await saveAuditReport(db, {
      name: "b",
      version: "1.0.0",
      source: "npm",
      url: "https://www.npmjs.com/package/b",
      model: "gpt-4o-mini",
      score: 60,
      resultJson: "{}",
    });

    const reports = await listAuditReports(db, 1);
    expect(reports).toHaveLength(1);
    expect(reports[0].name).toBe("b");
  });

  it("deleteAuditReport removes the report and its audit row", async () => {
    const { auditId, reportId } = await saveAuditReport(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      model: "gpt-4o-mini",
      score: 85,
      resultJson: "{}",
    });

    const deleted = await deleteAuditReport(db, reportId);
    expect(deleted).toBe(true);

    expect(await getAuditReportById(db, reportId)).toBeNull();
    expect(await getAuditById(db, auditId)).toBeNull();
  });

  it("deleteAuditReport returns false for a missing report", async () => {
    const deleted = await deleteAuditReport(db, 9999);
    expect(deleted).toBe(false);
  });

  it("deleteAuditReport keeps the audit row when other reports reference it", async () => {
    const { auditId, reportId } = await saveAuditReport(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      model: "gpt-4o-mini",
      score: 85,
      resultJson: "{}",
    });

    // Attach a second report to the same audit row.
    const second = await db
      .prepare(
        `INSERT INTO audit_reports (audit_id, model, score, result_json) VALUES (?, ?, ?, ?)`,
      )
      .bind(auditId, "gpt-4o-mini", 70, "{}")
      .run<{ id: number }>();
    const secondReportId = second.meta?.last_row_id as number;

    const deleted = await deleteAuditReport(db, reportId);
    expect(deleted).toBe(true);

    expect(await getAuditReportById(db, reportId)).toBeNull();
    expect(await getAuditById(db, auditId)).not.toBeNull();
    expect(await getAuditReportById(db, secondReportId)).not.toBeNull();
  });
});
