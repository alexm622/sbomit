import { z } from "zod";
import { getDb, updateUser } from "@/app/lib/db";
import { consumePasswordResetToken, hashPassword, createSession, authResponse } from "@/app/lib/auth";
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

const confirmSchema = z.object({
  token: z.string().min(1, "Reset token is required."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid reset data.");
    }

    const { token, password } = parsed.data;
    const db = await getDb();
    const userId = await consumePasswordResetToken(db, token);
    if (!userId) {
      throw new AuditError("UNAUTHORIZED", "Invalid or expired reset token.", 401);
    }

    const passwordHash = await hashPassword(password);
    await updateUser(db, userId, { passwordHash });

    const { cookie } = await createSession(db, userId);
    return authResponse({ ok: true }, { setCookie: cookie.setCookieHeader });
  } catch (error) {
    return handleApiError(error);
  }
}
