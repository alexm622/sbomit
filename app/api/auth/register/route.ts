import { z } from "zod";
import { getDb, createUser, getUserByUsername, getUserByEmail, isEmailBlocked, isUsernameBlocked } from "@/app/lib/db";
import { hashPassword, createSession, authResponse } from "@/app/lib/auth";
import { AuditError } from "@/app/lib/errors";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters.")
    .max(32, "Username must be at most 32 characters.")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, underscores, and dashes."),
  email: z.string().email("Enter a valid email address."),
  fullName: z.string().min(1, "Full name is required.").max(100, "Full name is too long."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);
  const { username, email, fullName, password } = parseWithSchema(registerSchema, body);
  const normalizedUsername = username.toLowerCase().trim();
  const normalizedEmail = email.toLowerCase().trim();

  const db = await getDb();

  if (await isUsernameBlocked(db, normalizedUsername)) {
    throw new AuditError("FORBIDDEN", "This username is not allowed.", 400);
  }
  if (await isEmailBlocked(db, normalizedEmail)) {
    throw new AuditError("FORBIDDEN", "This email is not allowed.", 400);
  }

  const existingUsername = await getUserByUsername(db, normalizedUsername);
  if (existingUsername) {
    throw new AuditError("CONFLICT", "Username is already taken.", 409);
  }

  const existingEmail = await getUserByEmail(db, normalizedEmail);
  if (existingEmail) {
    throw new AuditError("CONFLICT", "Email is already registered.", 409);
  }

  // The first registered user becomes an administrator.
  const anyUser = await db
    .prepare("SELECT 1 AS exists_user FROM users LIMIT 1")
    .first<{ exists_user: number }>();
  const isFirstUser = !anyUser;

  const passwordHash = await hashPassword(password);
  const userId = await createUser(db, {
    username: normalizedUsername,
    email: normalizedEmail,
    fullName: fullName.trim(),
    passwordHash,
    isAdmin: isFirstUser,
  });

  const { cookie } = await createSession(db, userId);

  return authResponse(
    {
      user: {
        id: userId,
        username: normalizedUsername,
        email: normalizedEmail,
        fullName: fullName.trim(),
        isAdmin: isFirstUser,
      },
    },
    { status: 201, setCookie: cookie.setCookieHeader },
  );
});
