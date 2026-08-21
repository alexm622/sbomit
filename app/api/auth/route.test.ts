import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { POST as register } from "./register/route";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as session } from "./session/route";

vi.mock("@/app/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/db")>();
  return {
    ...actual,
    getDb: vi.fn(() => Promise.resolve(env.DB)),
  };
});

async function setupAuthTables(db: D1Database) {
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
    `CREATE TABLE IF NOT EXISTS sessions (` +
      `id TEXT PRIMARY KEY,` +
      `user_id INTEGER NOT NULL,` +
      `expires_at DATETIME NOT NULL,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS blocked_emails (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `email TEXT UNIQUE NOT NULL,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
      `);`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS blocked_usernames (` +
      `id INTEGER PRIMARY KEY AUTOINCREMENT,` +
      `username TEXT UNIQUE NOT NULL,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
      `);`,
  );
}

describe("/api/auth", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupAuthTables(db);
  });

  afterEach(async () => {
    await reset();
    await setupAuthTables(db);
  });

  it("registers the first user as an admin and sets a session cookie", async () => {
    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        email: "admin@example.com",
        fullName: "Admin User",
        password: "password123",
      }),
    });

    const response = await register(request);
    expect(response.status).toBe(201);

    const data = (await response.json()) as { user: { id: number; isAdmin: boolean } };
    expect(data.user.isAdmin).toBe(true);

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("sbomit_session="))).toBe(true);
  });

  it("logs in an existing user", async () => {
    const registerReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "alice",
        email: "alice@example.com",
        fullName: "Alice",
        password: "password123",
      }),
    });
    const registerRes = await register(registerReq);
    expect(registerRes.status).toBe(201);

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password123" }),
    });
    const loginRes = await login(loginReq);
    expect(loginRes.status).toBe(200);

    const data = (await loginRes.json()) as { user: { username: string } };
    expect(data.user.username).toBe("alice");
  });

  it("rejects invalid login credentials", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "wrong" }),
    });
    const response = await login(request);
    expect(response.status).toBe(401);
  });

  it("returns the current session user", async () => {
    const registerReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "bob",
        email: "bob@example.com",
        fullName: "Bob",
        password: "password123",
      }),
    });
    const registerRes = await register(registerReq);
    const cookie = registerRes.headers.getSetCookie().find((c) => c.startsWith("sbomit_session="));
    expect(cookie).toBeDefined();

    const sessionReq = new Request("http://localhost/api/auth/session", {
      headers: { cookie: cookie ?? "" },
    });
    const sessionRes = await session(sessionReq);
    const data = (await sessionRes.json()) as { user: { username: string } };
    expect(data.user.username).toBe("bob");
  });

  it("logs out the current session", async () => {
    const registerReq = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "carol",
        email: "carol@example.com",
        fullName: "Carol",
        password: "password123",
      }),
    });
    const registerRes = await register(registerReq);
    const cookie = registerRes.headers.getSetCookie().find((c) => c.startsWith("sbomit_session="));

    const logoutReq = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookie ?? "" },
    });
    const logoutRes = await logout(logoutReq);
    expect(logoutRes.status).toBe(200);

    const sessionReq = new Request("http://localhost/api/auth/session", {
      headers: { cookie: cookie ?? "" },
    });
    const sessionRes = await session(sessionReq);
    expect(sessionRes.status).toBe(401);
  });
});
