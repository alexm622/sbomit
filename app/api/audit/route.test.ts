import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { POST } from "./route";
import type { AuditResult } from "@/app/lib/audit";

const mockRunAudit = vi.fn();

vi.mock("@/app/lib/run-audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/run-audit")>();
  return {
    ...actual,
    runAudit: (...args: unknown[]) => mockRunAudit(...args),
  };
});

const baseResult: AuditResult = {
  name: "lodash",
  version: "4.17.21",
  score: 85,
  summary: "Looks good.",
  risks: [],
  investigationAreas: [],
  deepDiveFindings: [],
  dependencies: [],
  license: { type: "MIT", compatible: true, note: "" },
  maintainers: [],
  lastPublished: "recently",
  weeklyDownloads: "many",
  cves: [],
};

const baseMeta = {
  cached: false,
  auditId: 1,
  reportId: 2,
  codebaseInspected: true,
  interactions: [
    {
      provider: "openai" as const,
      model: "gpt-4o-mini",
      systemPrompt: "system",
      userPrompt: "user",
      request: { model: "gpt-4o-mini" },
      response: { choices: [{ message: { parsed: baseResult } }] },
      startedAt: "2024-01-01T00:00:00.000Z",
      finishedAt: "2024-01-01T00:00:01.000Z",
      tokensInput: 100,
      tokensOutput: 50,
    },
  ],
};

function mockFetch(response: Response | (() => Response)) {
  return vi.fn(async () =>
    typeof response === "function" ? response() : response,
  );
}

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

describe("POST /api/audit", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupSchema(db);
  });

  beforeEach(() => {
    mockRunAudit.mockResolvedValue({
      result: baseResult,
      meta: baseMeta,
    });
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
    mockRunAudit.mockReset();
  });

  it("returns a fresh audit", async () => {
    globalThis.fetch = mockFetch(
      () => new Response(JSON.stringify({}), { status: 200 }),
    );

    const request = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryUrl: "https://www.npmjs.com/package/lodash",
      }),
    });

    const response = await POST(request);
    const data = (await response.json()) as {
      result: AuditResult;
      meta: {
        cached: boolean;
        auditId: number;
        reportId: number;
        interactions: { provider: string; model: string }[];
      };
    };

    expect(response.status).toBe(200);
    expect(data.meta.cached).toBe(false);
    expect(data.meta.auditId).toBe(1);
    expect(data.meta.reportId).toBe(2);
    expect(data.result.name).toBe("lodash");
    expect(data.meta.interactions).toHaveLength(1);
    expect(mockRunAudit).toHaveBeenCalledWith({
      libraryUrl: "https://www.npmjs.com/package/lodash",
      prompt: undefined,
    });
  });

  it("passes the custom prompt through", async () => {
    globalThis.fetch = mockFetch(
      () => new Response(JSON.stringify({}), { status: 200 }),
    );

    const request = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryUrl: "https://www.npmjs.com/package/lodash",
        prompt: "focus on security",
      }),
    });

    await POST(request);
    expect(mockRunAudit).toHaveBeenCalledWith({
      libraryUrl: "https://www.npmjs.com/package/lodash",
      prompt: "focus on security",
    });
  });

  it("returns 400 for missing libraryUrl", async () => {
    const request = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string; code: string };
    expect(data.code).toBe("MISSING_INPUT");
  });

  it("returns typed errors from runAudit", async () => {
    const { UnsupportedSourceError } = await import("@/app/lib/errors");
    mockRunAudit.mockRejectedValue(new UnsupportedSourceError());

    const request = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryUrl: "https://example.com/package/foo",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(422);
    const data = (await response.json()) as { error: string; code: string };
    expect(data.code).toBe("UNSUPPORTED_SOURCE");
  });
});
