import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { POST } from "./route";
import type { AuditResult } from "@/app/lib/audit";

const mockRunLibraryAudit = vi.fn();
const mockGetLlmConfig = vi.fn();

vi.mock("@/app/lib/llm", () => {
  return {
    runLibraryAudit: (...args: unknown[]) => mockRunLibraryAudit(...args),
    getLlmConfig: () => mockGetLlmConfig(),
  };
});

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

const baseResult: AuditResult = {
  name: "lodash",
  version: "4.17.21",
  score: 85,
  summary: "Looks good.",
  risks: [],
  dependencies: [],
  license: { type: "MIT", compatible: true, note: "" },
  maintainers: [],
  lastPublished: "recently",
  weeklyDownloads: "many",
};

const npmMetadata = {
  name: "lodash",
  version: "4.17.21",
  license: "MIT",
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
    mockGetLlmConfig.mockReturnValue({ model: "gpt-4o-mini" });
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
    mockRunLibraryAudit.mockReset();
    mockGetLlmConfig.mockReset();
  });

  it("returns a fresh audit and persists it", async () => {
    globalThis.fetch = mockFetch(
      () => new Response(JSON.stringify(npmMetadata), { status: 200 }),
    );
    mockRunLibraryAudit.mockResolvedValue(baseResult);

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
      meta: { cached: boolean; auditId: number; reportId: number };
    };

    expect(response.status).toBe(200);
    expect(data.meta.cached).toBe(false);
    expect(data.meta.auditId).toBeGreaterThan(0);
    expect(data.meta.reportId).toBeGreaterThan(0);
    expect(data.result.name).toBe("lodash");
  });

  it("returns a cached audit on identical input", async () => {
    globalThis.fetch = mockFetch(
      () => new Response(JSON.stringify(npmMetadata), { status: 200 }),
    );
    mockRunLibraryAudit.mockResolvedValue(baseResult);

    const first = await POST(
      new Request("http://localhost/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          libraryUrl: "https://www.npmjs.com/package/lodash",
          prompt: "focus on security",
        }),
      }),
    );
    const firstData = (await first.json()) as {
      meta: { cached: boolean; reportId: number };
    };
    expect(firstData.meta.cached).toBe(false);

    const second = await POST(
      new Request("http://localhost/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          libraryUrl: "https://www.npmjs.com/package/lodash",
          prompt: "focus on security",
        }),
      }),
    );
    const secondData = (await second.json()) as {
      meta: { cached: boolean; reportId: number };
    };
    expect(secondData.meta.reportId).toBe(firstData.meta.reportId);
    expect(mockRunLibraryAudit).toHaveBeenCalledTimes(1);
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

  it("returns 422 for unsupported source", async () => {
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

  it("returns 404 for unknown npm package", async () => {
    globalThis.fetch = mockFetch(() => new Response("Not Found", { status: 404 }));

    const request = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryUrl: "https://www.npmjs.com/package/not-a-real-pkg",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string; code: string };
    expect(data.code).toBe("PACKAGE_NOT_FOUND");
  });
});
