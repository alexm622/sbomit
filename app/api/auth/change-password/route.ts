import { z } from "zod";
import { getDb, getUserById, updateUser } from "@/app/lib/db";
import { requireAuth, verifyPassword, hashPassword, authResponse } from "@/app/lib/auth";
import { AuditError } from "@/app/lib/errors";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const changeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  const user = await requireAuth(db, request);

  const body = await parseJsonBody(request);
  const { currentPassword, newPassword } = parseWithSchema(changeSchema, body);

  const stored = await getUserById(db, user.id);
  if (!stored) {
    throw new AuditError("MISSING_INPUT", "User not found.", 400);
  }

  const valid = await verifyPassword(currentPassword, stored.password_hash);
  if (!valid) {
    return Response.json(
      { error: "Current password is incorrect.", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUser(db, user.id, { passwordHash });

  return authResponse({ ok: true });
});
