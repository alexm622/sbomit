import { z } from "zod";
import {
  getDb,
  createUser,
  listUsers,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  isEmailBlocked,
  isUsernameBlocked,
} from "@/app/lib/db";
import { requireAdmin, hashPassword, toPublicUser } from "@/app/lib/auth";
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

const createSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters.")
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  fullName: z.string().min(1).max(100),
  password: z.string().min(8),
  isAdmin: z.boolean().optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await requireAdmin(db, request);

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("q") ?? undefined;
    const limit = Number(searchParams.get("limit") ?? "100");
    const offset = Number(searchParams.get("offset") ?? "0");

    const users = await listUsers(db, { search, limit, offset });
    return Response.json({ users: users.map(toPublicUser) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await requireAdmin(db, request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid user data.");
    }

    const { username, email, fullName, password, isAdmin } = parsed.data;
    const normalizedUsername = username.toLowerCase().trim();
    const normalizedEmail = email.toLowerCase().trim();

    if (await isUsernameBlocked(db, normalizedUsername)) {
      throw new AuditError("FORBIDDEN", "This username is blocked.", 400);
    }
    if (await isEmailBlocked(db, normalizedEmail)) {
      throw new AuditError("FORBIDDEN", "This email is blocked.", 400);
    }
    if (await getUserByUsername(db, normalizedUsername)) {
      throw new AuditError("CONFLICT", "Username is already taken.", 409);
    }
    if (await getUserByEmail(db, normalizedEmail)) {
      throw new AuditError("CONFLICT", "Email is already registered.", 409);
    }

    const passwordHash = await hashPassword(password);
    const userId = await createUser(db, {
      username: normalizedUsername,
      email: normalizedEmail,
      fullName: fullName.trim(),
      passwordHash,
      isAdmin,
    });

    const user = await getUserById(db, userId);
    return Response.json({ user: user ? toPublicUser(user) : null }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
