import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import {
  saveDependencyTree,
  getDependenciesByAuditId,
  saveReport,
  getReportByPublicId,
  getRecentReportByUrl,
} from "./db";

describe("D1 helpers", () => {
  beforeEach(async () => {
    const db = env.DB;
    await db.exec("DELETE FROM audit_reports");
    await db.exec("DELETE FROM package_dependencies");
    await db.exec("DELETE FROM package_audits");
  });

  it("saves and retrieves a dependency tree", async () => {
    const db = env.DB;
    const auditId = await saveDependencyTree(
      db,
      {
        name: "lodash",
        version: "4.17.21",
        source: "npm",
        url: "https://www.npmjs.com/package/lodash",
      },
      [
        { name: "foo", version: "1.0.0", dependency_type: "dependencies" },
      ],
    );

    expect(auditId).toBeGreaterThan(0);

    const deps = await getDependenciesByAuditId(db, auditId);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      name: "foo",
      version: "1.0.0",
      dependency_type: "dependencies",
    });
  });

  it("saves and retrieves a report", async () => {
    const db = env.DB;
    const auditId = await saveDependencyTree(
      db,
      {
        name: "lodash",
        version: "4.17.21",
        source: "npm",
        url: "https://www.npmjs.com/package/lodash",
      },
      [],
    );

    const publicId = "report-123";
    await saveReport(db, auditId, {
      publicId,
      model: "gpt-4o-mini",
      score: 88,
      resultJson: JSON.stringify({ summary: "ok" }),
    });

    const report = await getReportByPublicId(db, publicId);
    expect(report).not.toBeNull();
    expect(report?.public_id).toBe(publicId);
    expect(report?.score).toBe(88);
  });

  it("finds a recent report by URL", async () => {
    const db = env.DB;
    const url = "https://www.npmjs.com/package/express";
    const auditId = await saveDependencyTree(
      db,
      { name: "express", version: "4.18.0", source: "npm", url },
      [],
    );

    await saveReport(db, auditId, {
      publicId: "recent-report",
      model: "gpt-4o-mini",
      score: 70,
      resultJson: JSON.stringify({}),
    });

    const recent = await getRecentReportByUrl(db, url, 24);
    expect(recent).not.toBeNull();
    expect(recent?.public_id).toBe("recent-report");
  });
});
