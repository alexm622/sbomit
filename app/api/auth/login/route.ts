import { z } from "zod";
import { getDb, getUserByUsername, getUserByEmail } from "@/app/lib/db";
import { verifyPassword, createSession, authResponse } from "@/app/lib/auth";
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

const loginSchema = z.object({
  username: z.string().min(1, "Username or email is required."),
  password: z.string().min(1, "Password is required."),
});

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid login data.");
    }

    const { username, password } = parsed.data;
    const normalized = username.toLowerCase().trim();

    const db = await getDb();
    const user = normalized.includes("@")
      ? await getUserByEmail(db, normalized)
      : await getUserByUsername(db, normalized);

    if (!user || user.is_blocked === 1) {
      throw new AuditError("UNAUTHORIZED", "Invalid credentials.", 401);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      throw new AuditError("UNAUTHORIZED", "Invalid credentials.", 401);
    }

    const { cookie } = await createSession(db, user.id);

    return authResponse(
      {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.full_name,
          isAdmin: user.is_admin === 1,
        },
      },
      { setCookie: cookie.setCookieHeader },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
