import { AuditError } from "./errors";

const SESSION_COOKIE = "sbomit_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const PASSWORD_RESET_DURATION_MS = 1000 * 60 * 60; // 1 hour
const PBKDF2_ITERATIONS = 100_000;
const TOKEN_BYTES = 32;

function getAuthSecret(): string {
  return (
    (process.env.AUTH_SECRET as string | undefined) ??
    "dev-secret-change-me-in-production"
  );
}

function encodeBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signValue(value: string): Promise<string> {
  const key = await importHmacKey(getAuthSecret());
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return encodeBase64Url(signature);
}

async function verifyValue(value: string, signature: string): Promise<boolean> {
  const key = await importHmacKey(getAuthSecret());
  const encoder = new TextEncoder();
  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    encoder.encode(value),
  );
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function serializeCookie(name: string, value: string, maxAgeMs: number): string {
  const maxAgeSeconds = Math.floor(maxAgeMs / 1000);
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function expiredCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookieHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match?.[1] ?? null;
}

async function parseSessionToken(request: Request): Promise<string | null> {
  const cookie = parseCookieHeader(request.headers.get("cookie"), SESSION_COOKIE);
  if (!cookie) return null;
  const [token, signature] = cookie.split(".", 2);
  if (!token || !signature) return null;
  const valid = await verifyValue(token, signature);
  return valid ? token : null;
}

// Password hashing using PBKDF2-SHA256.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const saltB64 = encodeBase64Url(salt);
  const hashB64 = encodeBase64Url(derived);
  return `$pbkdf2-sha256$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 5 || parts[1] !== "pbkdf2-sha256") {
    return false;
  }
  const iterations = Number(parts[2]);
  const salt = decodeBase64Url(parts[3]);
  const expectedHash = parts[4];
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const actualHash = encodeBase64Url(derived);
  return constantTimeEqual(encoder.encode(expectedHash), encoder.encode(actualHash));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export interface PublicUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
}

export function toPublicUser(row: {
  id: number;
  username: string;
  email: string;
  full_name: string;
  is_admin: number;
  is_blocked: number;
  created_at: string;
  updated_at: string;
}): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    isAdmin: row.is_admin === 1,
    isBlocked: row.is_blocked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SessionCookie {
  setCookieHeader: string;
  clearCookieHeader: string;
}

export async function createSession(
  db: D1Database,
  userId: number,
): Promise<{ token: string; cookie: SessionCookie }> {
  const token = randomToken();
  const signature = await signValue(token);
  const cookieValue = `${token}.${signature}`;
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(token, userId, expiresAt.toISOString())
    .run();

  return {
    token,
    cookie: {
      setCookieHeader: serializeCookie(SESSION_COOKIE, cookieValue, SESSION_DURATION_MS),
      clearCookieHeader: expiredCookie(SESSION_COOKIE),
    },
  };
}

export async function getSessionUser(
  db: D1Database,
  request: Request,
): Promise<SessionUser | null> {
  const token = await parseSessionToken(request);
  if (!token) return null;

  const row = await db
    .prepare(
      `SELECT s.id, u.id AS user_id, u.username, u.email, u.full_name, u.is_admin, u.is_blocked
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`,
    )
    .bind(token)
    .first<{
      user_id: number;
      username: string;
      email: string;
      full_name: string;
      is_admin: number;
      is_blocked: number;
    }>();

  if (!row || row.is_blocked === 1) return null;

  return {
    id: row.user_id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    isAdmin: row.is_admin === 1,
  };
}

export async function deleteSession(
  db: D1Database,
  request: Request,
): Promise<void> {
  const token = await parseSessionToken(request);
  if (!token) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
}

export function authResponse(
  body: unknown,
  init: ResponseInit & { setCookie?: string; clearCookie?: string } = {},
): Response {
  const headers = new Headers(init.headers);
  if (init.setCookie) {
    headers.append("Set-Cookie", init.setCookie);
  }
  if (init.clearCookie) {
    headers.append("Set-Cookie", init.clearCookie);
  }
  return Response.json(body, { ...init, headers });
}

export async function requireAuth(
  db: D1Database,
  request: Request,
): Promise<SessionUser> {
  const user = await getSessionUser(db, request);
  if (!user) {
    throw new AuditError("UNAUTHORIZED", "Authentication required.", 401);
  }
  return user;
}

export async function requireAdmin(
  db: D1Database,
  request: Request,
): Promise<SessionUser> {
  const user = await requireAuth(db, request);
  if (!user.isAdmin) {
    throw new AuditError("FORBIDDEN", "Admin access required.", 403);
  }
  return user;
}

export async function createPasswordResetToken(
  db: D1Database,
  userId: number,
): Promise<string> {
  const raw = randomToken();
  const tokenHash = await sha256Hex(raw);
  const id = randomToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_DURATION_MS);

  await db
    .prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, userId, tokenHash, expiresAt.toISOString())
    .run();

  return raw;
}

export async function consumePasswordResetToken(
  db: D1Database,
  token: string,
): Promise<number | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ id: string; user_id: number }>();

  if (!row) return null;

  await db
    .prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?")
    .bind(row.id)
    .run();

  return row.user_id;
}

export function setAuthCookie(response: Response, setCookieHeader: string): Response {
  response.headers.append("Set-Cookie", setCookieHeader);
  return response;
}

export function clearAuthCookie(response: Response, clearCookieHeader: string): Response {
  response.headers.append("Set-Cookie", clearCookieHeader);
  return response;
}
