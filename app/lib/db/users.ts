export interface StoredUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  password_hash: string;
  is_admin: number;
  is_blocked: number;
  created_at: string;
  updated_at: string;
}

export interface UserInput {
  username: string;
  email: string;
  fullName: string;
  passwordHash: string;
  isAdmin?: boolean;
}

export async function createUser(
  db: D1Database,
  input: UserInput,
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO users (username, email, full_name, password_hash, is_admin)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      input.username,
      input.email,
      input.fullName,
      input.passwordHash,
      input.isAdmin ? 1 : 0,
    )
    .run<{ id: number }>();
  return result.meta?.last_row_id as number;
}

export async function getUserById(
  db: D1Database,
  id: number,
): Promise<StoredUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .bind(id)
    .first<StoredUser>();
}

export async function getUserByUsername(
  db: D1Database,
  username: string,
): Promise<StoredUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE username = ? LIMIT 1")
    .bind(username)
    .first<StoredUser>();
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<StoredUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<StoredUser>();
}

export async function listUsers(
  db: D1Database,
  options: { search?: string; limit?: number; offset?: number } = {},
): Promise<StoredUser[]> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (options.search) {
    const pattern = `%${options.search}%`;
    const result = await db
      .prepare(
        `SELECT * FROM users
         WHERE username LIKE ? OR email LIKE ? OR full_name LIKE ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(pattern, pattern, pattern, limit, offset)
      .all<StoredUser>();
    return result.results || [];
  }
  const result = await db
    .prepare(
      `SELECT * FROM users ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<StoredUser>();
  return result.results || [];
}

export async function updateUser(
  db: D1Database,
  id: number,
  input: {
    email?: string;
    fullName?: string;
    passwordHash?: string;
    isAdmin?: boolean;
    isBlocked?: boolean;
  },
): Promise<boolean> {
  const existing = await getUserById(db, id);
  if (!existing) return false;

  const email = input.email ?? existing.email;
  const fullName = input.fullName ?? existing.full_name;
  const passwordHash = input.passwordHash ?? existing.password_hash;
  const isAdmin = input.isAdmin !== undefined ? (input.isAdmin ? 1 : 0) : existing.is_admin;
  const isBlocked = input.isBlocked !== undefined ? (input.isBlocked ? 1 : 0) : existing.is_blocked;

  const result = await db
    .prepare(
      `UPDATE users
       SET email = ?, full_name = ?, password_hash = ?, is_admin = ?, is_blocked = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(email, fullName, passwordHash, isAdmin, isBlocked, id)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function deleteUser(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function isEmailBlocked(
  db: D1Database,
  email: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS blocked FROM blocked_emails WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ blocked: number }>();
  return Boolean(row?.blocked);
}

export async function isUsernameBlocked(
  db: D1Database,
  username: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS blocked FROM blocked_usernames WHERE username = ? LIMIT 1")
    .bind(username)
    .first<{ blocked: number }>();
  return Boolean(row?.blocked);
}

export async function addBlockedEmail(
  db: D1Database,
  email: string,
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO blocked_emails (email) VALUES (?)")
    .bind(email)
    .run();
}

export async function removeBlockedEmail(
  db: D1Database,
  email: string,
): Promise<void> {
  await db.prepare("DELETE FROM blocked_emails WHERE email = ?").bind(email).run();
}

export async function listBlockedEmails(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT email FROM blocked_emails ORDER BY email")
    .all<{ email: string }>();
  return (result.results || []).map((r) => r.email);
}

export async function addBlockedUsername(
  db: D1Database,
  username: string,
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO blocked_usernames (username) VALUES (?)")
    .bind(username)
    .run();
}

export async function removeBlockedUsername(
  db: D1Database,
  username: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM blocked_usernames WHERE username = ?")
    .bind(username)
    .run();
}

export async function listBlockedUsernames(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT username FROM blocked_usernames ORDER BY username")
    .all<{ username: string }>();
  return (result.results || []).map((r) => r.username);
}
