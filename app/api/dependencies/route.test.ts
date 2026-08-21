import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { POST } from "./route";

vi.mock("@/app/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/db")>();
  return {
    ...actual,
    getDb: vi.fn(() => Promise.resolve(env.DB)),
  };
});

vi.mock("@/app/lib/auth", () => ({
  requireAuth: vi.fn(() =>
    Promise.resolve({ id: 1, username: "tester", email: "tester@example.com", fullName: "Tester", isAdmin: false }),
  ),
}));

async function setupSchema(db: D1Database) {
  await db.exec("DROP TABLE IF EXISTS package_dependencies");
  await db.exec("DROP TABLE IF EXISTS package_audits");
  await db.exec("DROP TABLE IF EXISTS users");
  await db.exec(
    `CREATE TABLE IF NOT EXISTS users (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT` +
      `);`,
  );
  await db.exec("INSERT OR IGNORE INTO users (id) VALUES (1)");
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
      `dependency_type TEXT NOT NULL` +
      `);`,
  );
}

describe("POST /api/dependencies", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupSchema(db);
  });

  afterEach(async () => {
    await reset();
    await setupSchema(db);
  });

  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("extracts npm dependencies", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === "https://registry.npmjs.org/lodash") {
        return new Response(
          JSON.stringify({
            name: "lodash",
            "dist-tags": { latest: "4.17.21" },
            versions: {
              "4.17.21": {
                name: "lodash",
                dependencies: {},
                devDependencies: { jest: "^29.0.0" },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const request = new Request("http://localhost/api/dependencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libraryUrl: "https://www.npmjs.com/package/lodash" }),
    });

    const response = await POST(request);
    const data = (await response.json()) as {
      dependencies: Array<{ name: string; version: string; dependency_type: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.dependencies).toHaveLength(1);
    expect(data.dependencies[0]).toMatchObject({
      name: "jest",
      version: "^29.0.0",
      dependency_type: "devDependencies",
    });
  });

  it("extracts GitHub dependencies from fetched manifest", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === "https://api.github.com/repos/facebook/react") {
        return new Response(
          JSON.stringify({
            full_name: "facebook/react",
            default_branch: "main",
          }),
          { status: 200 },
        );
      }
      if (url === "https://raw.githubusercontent.com/facebook/react/main/package.json") {
        return new Response(
          JSON.stringify({
            dependencies: { "object-assign": "^4.1.1" },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const request = new Request("http://localhost/api/dependencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libraryUrl: "https://github.com/facebook/react" }),
    });

    const response = await POST(request);
    const data = (await response.json()) as {
      dependencies: Array<{ name: string; version: string; dependency_type: string }>;
      source: string;
    };

    expect(response.status).toBe(200);
    expect(data.source).toBe("github");
    expect(data.dependencies).toHaveLength(1);
    expect(data.dependencies[0]).toMatchObject({
      name: "object-assign",
      version: "^4.1.1",
      dependency_type: "dependencies",
    });
  });
});
