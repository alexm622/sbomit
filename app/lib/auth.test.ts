import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
  createPasswordResetToken,
  consumePasswordResetToken,
} from "./auth";

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
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (` +
      `id TEXT PRIMARY KEY,` +
      `user_id INTEGER NOT NULL,` +
      `token_hash TEXT NOT NULL,` +
      `expires_at DATETIME NOT NULL,` +
      `used_at DATETIME,` +
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

function cookieValue(setCookieHeader: string): string {
  return setCookieHeader.split("=")[1].split(";")[0];
}

async function insertUser(
  db: D1Database,
  input: {
    username: string;
    email: string;
    fullName: string;
    passwordHash: string;
    isAdmin?: boolean;
    isBlocked?: boolean;
  },
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO users (username, email, full_name, password_hash, is_admin, is_blocked)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.username,
      input.email,
      input.fullName,
      input.passwordHash,
      input.isAdmin ? 1 : 0,
      input.isBlocked ? 1 : 0,
    )
    .run<{ id: number }>();
  return result.meta?.last_row_id as number;
}

describe("auth helpers", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupAuthTables(db);
  });

  afterEach(async () => {
    await reset();
    await setupAuthTables(db);
  });

  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$pbkdf2-sha256\$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("returns false for malformed password hashes", async () => {
    expect(await verifyPassword("password", "not-a-hash")).toBe(false);
  });

  it("creates and validates sessions", async () => {
    const passwordHash = await hashPassword("password123");
    const userId = await insertUser(db, {
      username: "alice",
      email: "alice@example.com",
      fullName: "Alice",
      passwordHash,
    });

    const { cookie } = await createSession(db, userId);
    const request = new Request("http://localhost/", {
      headers: { cookie: `sbomit_session=${cookieValue(cookie.setCookieHeader)}` },
    });

    const user = await getSessionUser(db, request);
    expect(user).not.toBeNull();
    expect(user?.id).toBe(userId);
    expect(user?.username).toBe("alice");
    expect(user?.isAdmin).toBe(false);
  });

  it("rejects expired sessions", async () => {
    const passwordHash = await hashPassword("password123");
    const userId = await insertUser(db, {
      username: "bob",
      email: "bob@example.com",
      fullName: "Bob",
      passwordHash,
    });

    const { cookie } = await createSession(db, userId);
    const value = cookieValue(cookie.setCookieHeader);
    const sessionId = value.split(".")[0];
    // Expire the session.
    await db
      .prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE id = ?")
      .bind(sessionId)
      .run();

    const request = new Request("http://localhost/", {
      headers: { cookie: `sbomit_session=${value}` },
    });
    const user = await getSessionUser(db, request);
    expect(user).toBeNull();
  });

  it("rejects sessions for blocked users", async () => {
    const passwordHash = await hashPassword("password123");
    const userId = await insertUser(db, {
      username: "carol",
      email: "carol@example.com",
      fullName: "Carol",
      passwordHash,
      isBlocked: true,
    });

    const { cookie } = await createSession(db, userId);
    const request = new Request("http://localhost/", {
      headers: { cookie: `sbomit_session=${cookieValue(cookie.setCookieHeader)}` },
    });
    const user = await getSessionUser(db, request);
    expect(user).toBeNull();
  });

  it("deletes sessions", async () => {
    const passwordHash = await hashPassword("password123");
    const userId = await insertUser(db, {
      username: "dave",
      email: "dave@example.com",
      fullName: "Dave",
      passwordHash,
    });

    const { cookie } = await createSession(db, userId);
    const token = cookie.setCookieHeader.split("=")[1].split(";")[0];
    const request = new Request("http://localhost/", {
      headers: { cookie: `sbomit_session=${token}` },
    });

    await deleteSession(db, request);
    const user = await getSessionUser(db, request);
    expect(user).toBeNull();
  });

  it("creates and consumes password reset tokens", async () => {
    const passwordHash = await hashPassword("password123");
    const userId = await insertUser(db, {
      username: "eve",
      email: "eve@example.com",
      fullName: "Eve",
      passwordHash,
    });

    const token = await createPasswordResetToken(db, userId);
    const consumedUserId = await consumePasswordResetToken(db, token);
    expect(consumedUserId).toBe(userId);

    // Tokens cannot be reused.
    const secondAttempt = await consumePasswordResetToken(db, token);
    expect(secondAttempt).toBeNull();
  });

  it("rejects expired password reset tokens", async () => {
    const passwordHash = await hashPassword("password123");
    const userId = await insertUser(db, {
      username: "frank",
      email: "frank@example.com",
      fullName: "Frank",
      passwordHash,
    });

    const token = await createPasswordResetToken(db, userId);
    await db
      .prepare("UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 day')")
      .run();

    const consumedUserId = await consumePasswordResetToken(db, token);
    expect(consumedUserId).toBeNull();
  });
});
