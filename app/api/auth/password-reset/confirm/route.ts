import { z } from "zod";
import { getDb, updateUser } from "@/app/lib/db";
import { consumePasswordResetToken, hashPassword, createSession, authResponse } from "@/app/lib/auth";
import { AuditError } from "@/app/lib/errors";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const confirmSchema = z.object({
  token: z.string().min(1, "Reset token is required."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);
  const { token, password } = parseWithSchema(confirmSchema, body);
  const db = await getDb();
  const userId = await consumePasswordResetToken(db, token);
  if (!userId) {
    throw new AuditError("UNAUTHORIZED", "Invalid or expired reset token.", 401);
  }

  const passwordHash = await hashPassword(password);
  await updateUser(db, userId, { passwordHash });

  const { cookie } = await createSession(db, userId);
  return authResponse({ ok: true }, { setCookie: cookie.setCookieHeader });
});
