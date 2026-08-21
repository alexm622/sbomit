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
  listAuditReports,
  deleteAuditReport,
  getDependenciesByAuditId,
  getAuditReportFindings,
  createProvider,
  updateProvider,
  getProviderById,
  getOverallStats,
  createUser,
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
      `user_id INTEGER,` +
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
      `public_id TEXT NOT NULL UNIQUE,` +
      `prompt TEXT,` +
      `model TEXT NOT NULL,` +
      `score INTEGER NOT NULL,` +
      `result_json TEXT NOT NULL,` +
      `cache_key TEXT UNIQUE,` +
      `interaction_json TEXT,` +
      `codebase_inspected INTEGER DEFAULT 0,` +
      `tokens_total INTEGER,` +
      `provider_models TEXT,` +
      `cached INTEGER NOT NULL DEFAULT 0,` +
      `cache_hits INTEGER NOT NULL DEFAULT 0,` +
      `started_at TEXT,` +
      `finished_at TEXT,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP,` +
      `FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_risks (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `report_id INTEGER NOT NULL,` +
      `severity TEXT NOT NULL,` +
      `title TEXT NOT NULL,` +
      `description TEXT NOT NULL,` +
      `FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_cves (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `report_id INTEGER NOT NULL,` +
      `cve_id TEXT NOT NULL,` +
      `aliases TEXT,` +
      `severity TEXT,` +
      `title TEXT NOT NULL,` +
      `description TEXT NOT NULL,` +
      `published TEXT,` +
      `modified TEXT,` +
      `fixed_version TEXT,` +
      `references_json TEXT,` +
      `FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_findings (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `report_id INTEGER NOT NULL,` +
      `area TEXT NOT NULL,` +
      `file TEXT NOT NULL,` +
      `issue TEXT NOT NULL,` +
      `evidence TEXT,` +
      `severity TEXT NOT NULL,` +
      `FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_investigation_areas (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `report_id INTEGER NOT NULL,` +
      `area TEXT NOT NULL,` +
      `rationale TEXT NOT NULL,` +
      `FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_investigation_files (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `area_id INTEGER NOT NULL,` +
      `file TEXT NOT NULL,` +
      `FOREIGN KEY (area_id) REFERENCES audit_investigation_areas(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS audit_report_dependencies (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `report_id INTEGER NOT NULL,` +
      `name TEXT NOT NULL,` +
      `version TEXT NOT NULL,` +
      `license TEXT NOT NULL,` +
      `transitive INTEGER NOT NULL DEFAULT 0,` +
      `FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS providers (` +
      `id TEXT PRIMARY KEY,` +
      `name TEXT NOT NULL,` +
      `provider TEXT NOT NULL,` +
      `api_key TEXT NOT NULL,` +
      `base_url TEXT,` +
      `models TEXT NOT NULL,` +
      `is_default INTEGER NOT NULL DEFAULT 0,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP,` +
      `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
      `);`,
  );

  await db.exec(
    `CREATE TABLE IF NOT EXISTS users (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `username TEXT UNIQUE NOT NULL,` +
      `email TEXT UNIQUE NOT NULL,` +
      `full_name TEXT NOT NULL,` +
      `password_hash TEXT NOT NULL,` +
      `is_admin INTEGER NOT NULL DEFAULT 0,` +
      `is_blocked INTEGER NOT NULL DEFAULT 0,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP,` +
      `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
      `);`,
  );

  await db.exec(
    `CREATE TABLE IF NOT EXISTS provider_usage (` +
      `provider_id TEXT NOT NULL,` +
      `usage_date TEXT NOT NULL,` +
      `tokens_total INTEGER NOT NULL DEFAULT 0,` +
      `PRIMARY KEY (provider_id, usage_date)` +
      `);`,
  );

  await db.exec(
    `CREATE TABLE IF NOT EXISTS provider_limits (` +
      `provider_id TEXT PRIMARY KEY,` +
      `daily_token_limit INTEGER,` +
      `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
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

  it("saveAuditReport persists all findings into normalized tables", async () => {
    const fullResult = {
      name: "lodash",
      version: "4.17.21",
      score: 85,
      summary: "Looks good.",
      risks: [
        { severity: "high", title: "Old dep", description: "a" },
      ],
      investigationAreas: [
        { area: "Scripts", rationale: "r", files: ["package.json"] },
      ],
      deepDiveFindings: [
        {
          area: "Scripts",
          file: "package.json",
          issue: "postinstall script",
          evidence: '"postinstall": "x"',
          severity: "medium",
        },
      ],
      dependencies: [
        { name: "dep-a", version: "1.0.0", license: "MIT", transitive: false },
      ],
      license: { type: "MIT", compatible: true, note: "" },
      maintainers: [],
      lastPublished: "recently",
      weeklyDownloads: "many",
      cves: [
        {
          id: "CVE-2024-1234",
          aliases: ["GHSA-abc"],
          severity: "high",
          title: "Bad bug",
          description: "desc",
          published: "2024-01-01",
          modified: "2024-01-02",
          fixedVersion: "1.0.1",
          references: [{ type: "advisory", url: "https://example.com" }],
        },
      ],
    };

    const { reportId } = await saveAuditReport(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      model: "gpt-4o-mini",
      score: 85,
      resultJson: JSON.stringify(fullResult),
    });

    const findings = await getAuditReportFindings(db, reportId);
    expect(findings.risks).toHaveLength(1);
    expect(findings.risks[0].severity).toBe("high");
    expect(findings.cves).toHaveLength(1);
    expect(findings.cves[0].cve_id).toBe("CVE-2024-1234");
    expect(findings.investigationAreas).toHaveLength(1);
    expect(findings.investigationFiles).toHaveLength(1);
    expect(findings.investigationFiles[0].file).toBe("package.json");
    expect(findings.findings).toHaveLength(1);
    expect(findings.findings[0].severity).toBe("medium");
    expect(findings.dependencies).toHaveLength(1);
    expect(findings.dependencies[0].name).toBe("dep-a");
  });

  it("saveAuditReport persists interaction_json", async () => {
    const { reportId } = await saveAuditReport(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      model: "gpt-4o-mini",
      score: 85,
      resultJson: JSON.stringify({ score: 85 }),
      interactionJson: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        tokensInput: 100,
        tokensOutput: 50,
        startedAt: "2024-01-01T00:00:00.000Z",
        finishedAt: "2024-01-01T00:00:02.000Z",
      }),
    });

    const report = await getAuditReportById(db, reportId);
    expect(report?.interaction_json).toContain("openai");

    const reports = await listAuditReports(db);
    expect(reports[0].provider).toBe("openai");
    expect(reports[0].tokens_input).toBe(100);
    expect(reports[0].tokens_output).toBe(50);
    expect(reports[0].tokens_total).toBe(150);
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
        `INSERT INTO audit_reports (audit_id, public_id, model, score, result_json) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(auditId, "second-report", "gpt-4o-mini", 70, "{}")
      .run<{ id: number }>();
    const secondReportId = second.meta?.last_row_id as number;

    const deleted = await deleteAuditReport(db, reportId);
    expect(deleted).toBe(true);

    expect(await getAuditReportById(db, reportId)).toBeNull();
    expect(await getAuditById(db, auditId)).not.toBeNull();
    expect(await getAuditReportById(db, secondReportId)).not.toBeNull();
  });

  it("createProvider and updateProvider persist the api key", async () => {
    const id = await createProvider(db, {
      name: "OpenAI",
      provider: "openai",
      apiKey: "",
      models: ["gpt-4o-mini"],
      isDefault: true,
    });

    let stored = await getProviderById(db, id);
    expect(stored).not.toBeNull();
    expect(stored?.api_key).toBe("");

    await updateProvider(db, id, {
      name: "OpenAI Updated",
      apiKey: "sk-secret-key",
    });

    stored = await getProviderById(db, id);
    expect(stored?.name).toBe("OpenAI Updated");
    expect(stored?.api_key).toBe("sk-secret-key");

    // Empty apiKey should keep the existing key.
    await updateProvider(db, id, { apiKey: "" });
    stored = await getProviderById(db, id);
    expect(stored?.api_key).toBe("sk-secret-key");
  });

  it("getOverallStats returns aggregated stats and breakdowns", async () => {
    const userA = await createUser(db, {
      username: "alice",
      email: "alice@example.com",
      fullName: "Alice",
      passwordHash: "hash",
    });
    const userB = await createUser(db, {
      username: "bob",
      email: "bob@example.com",
      fullName: "Bob",
      passwordHash: "hash",
    });

    const openaiId = await createProvider(db, {
      name: "OpenAI",
      provider: "openai",
      apiKey: "",
      models: ["gpt-4o-mini"],
    });
    const moonshotId = await createProvider(db, {
      name: "Moonshot",
      provider: "openai",
      apiKey: "",
      models: ["kimi-k2.7-code"],
    });

    await saveAuditReport(db, {
      name: "lodash",
      version: "4.17.21",
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      model: "openai/gpt-4o-mini",
      score: 85,
      resultJson: JSON.stringify({ score: 85 }),
      interactionJson: JSON.stringify([
        {
          provider: "openai",
          providerId: openaiId,
          model: "gpt-4o-mini",
          tokensInput: 100,
          tokensOutput: 50,
        },
      ]),
      userId: userA,
    });

    await saveAuditReport(db, {
      name: "react",
      version: "latest",
      source: "github",
      url: "https://github.com/facebook/react",
      model: "openai/kimi-k2.7-code",
      score: 90,
      resultJson: JSON.stringify({ score: 90 }),
      interactionJson: JSON.stringify([
        {
          provider: "openai",
          providerId: moonshotId,
          model: "kimi-k2.7-code",
          tokensInput: 200,
          tokensOutput: 100,
        },
      ]),
      userId: userB,
    });

    const stats = await getOverallStats(db);

    expect(stats.totalAudits).toBe(2);
    expect(stats.totalUsers).toBe(2);
    expect(stats.totalTokens).toBe(450);
    expect(stats.avgTokensPerAudit).toBe(225);
    expect(stats.tokensOverTime.length).toBeGreaterThan(0);
    const todayRow = stats.tokensOverTime[stats.tokensOverTime.length - 1];
    expect(todayRow.tokens).toBe(450);
    expect(todayRow.audits).toBe(2);

    const openai = stats.tokensByProvider.find((p) => p.provider === "OpenAI");
    expect(openai?.tokens).toBe(150);
    expect(openai?.audits).toBe(1);
    expect(openai?.avgTokens).toBe(150);
    const moonshot = stats.tokensByProvider.find(
      (p) => p.provider === "Moonshot",
    );
    expect(moonshot?.tokens).toBe(300);
    expect(moonshot?.audits).toBe(1);
    expect(moonshot?.avgTokens).toBe(300);

    const gpt = stats.tokensByModel.find((m) => m.model === "gpt-4o-mini");
    expect(gpt?.tokens).toBe(150);
    expect(gpt?.audits).toBe(1);
    expect(gpt?.avgTokens).toBe(150);
    const kimi = stats.tokensByModel.find((m) => m.model === "kimi-k2.7-code");
    expect(kimi?.tokens).toBe(300);
    expect(kimi?.audits).toBe(1);
    expect(kimi?.avgTokens).toBe(300);

    expect(stats.topUsers).toHaveLength(2);
    expect(stats.topUsers[0].username).toBe("bob");
    expect(stats.topUsers[0].tokensTotal).toBe(300);
    expect(stats.topUsers[1].username).toBe("alice");
    expect(stats.topUsers[1].tokensTotal).toBe(150);
  });
});
