import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { GET, DELETE } from "./route";

vi.mock("@/app/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/db")>(
    "@/app/lib/db",
  );
  const { env } = await import("cloudflare:workers");
  return {
    ...actual,
    getDb: async (passedEnv?: Record<string, unknown>) => {
      if (passedEnv?.DB) return passedEnv.DB as D1Database;
      return actual.getDb({ DB: env.DB } as Record<string, unknown>);
    },
  };
});

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
      `interaction_json TEXT,` +
      `codebase_inspected INTEGER DEFAULT 0,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP,` +
      `FOREIGN KEY (audit_id) REFERENCES package_audits(id) ON DELETE CASCADE` +
      `);`,
  );
}

async function createReport(db: D1Database) {
  const audit = await db
    .prepare(
      `INSERT INTO package_audits (name, version, source, url) VALUES (?, ?, ?, ?)`,
    )
    .bind("lodash", "4.17.21", "npm", "https://www.npmjs.com/package/lodash")
    .run<{ id: number }>();
  const auditId = audit.meta?.last_row_id as number;

  const report = await db
    .prepare(
      `INSERT INTO audit_reports (audit_id, prompt, model, score, result_json, interaction_json) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      auditId,
      null,
      "gpt-4o-mini",
      85,
      JSON.stringify({ score: 85 }),
      JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        systemPrompt: "system",
        userPrompt: "user",
        request: { model: "gpt-4o-mini" },
        response: { choices: [] },
        startedAt: "2024-01-01T00:00:00.000Z",
        finishedAt: "2024-01-01T00:00:01.000Z",
        tokensInput: 100,
        tokensOutput: 50,
      }),
    )
    .run<{ id: number }>();
  const reportId = report.meta?.last_row_id as number;

  return { auditId, reportId };
}

describe("GET /api/audits/[id]", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupSchema(db);
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
  });

  it("returns the audit report with interaction log", async () => {
    const { reportId } = await createReport(db);

    const response = await GET(
      new Request(`http://localhost/api/audits/${reportId}`),
      { params: Promise.resolve({ id: String(reportId) }) },
    );
    const data = (await response.json()) as {
      audit: { name: string };
      report: { model: string };
      interactions: { provider: string; tokensInput: number }[];
    };

    expect(response.status).toBe(200);
    expect(data.audit.name).toBe("lodash");
    expect(data.report.model).toBe("gpt-4o-mini");
    expect(data.interactions).toHaveLength(1);
    expect(data.interactions[0].provider).toBe("openai");
    expect(data.interactions[0].tokensInput).toBe(100);
  });

  it("returns 404 for a missing report", async () => {
    const response = await GET(
      new Request("http://localhost/api/audits/9999"),
      { params: Promise.resolve({ id: "9999" }) },
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 for an invalid report id", async () => {
    const response = await GET(
      new Request("http://localhost/api/audits/abc"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/audits/[id]", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupSchema(db);
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
  });

  it("deletes an existing report", async () => {
    const { reportId } = await createReport(db);

    const response = await DELETE(
      new Request(`http://localhost/api/audits/${reportId}`),
      { params: Promise.resolve({ id: String(reportId) }) },
    );
    const data = (await response.json()) as { deleted: boolean };

    expect(response.status).toBe(200);
    expect(data.deleted).toBe(true);
  });
});
