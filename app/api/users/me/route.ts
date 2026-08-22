import { z } from "zod";
import {
  getDb,
  getUserById,
  updateUser,
  getUserByEmail,
  isEmailBlocked,
} from "@/app/lib/db";
import { requireAuth, toPublicUser } from "@/app/lib/auth";
import { AuditError, MissingInputError } from "@/app/lib/errors";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const updateSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(100).optional(),
});

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  const sessionUser = await requireAuth(db, request);
  const user = await getUserById(db, sessionUser.id);
  if (!user) {
    throw new AuditError("NOT_FOUND", "User not found.", 404);
  }
  return Response.json({ user: toPublicUser(user) });
});

export const PUT = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  const sessionUser = await requireAuth(db, request);

  const body = await parseJsonBody(request);
  const parsed = parseWithSchema(updateSchema, body);

  const existing = await getUserById(db, sessionUser.id);
  if (!existing) {
    throw new AuditError("NOT_FOUND", "User not found.", 404);
  }

  const email = parsed.email?.toLowerCase().trim();
  if (email && email !== existing.email) {
    if (await isEmailBlocked(db, email)) {
      throw new MissingInputError("This email address is not allowed.");
    }
    if (await getUserByEmail(db, email)) {
      throw new AuditError("CONFLICT", "Email is already registered.", 409);
    }
  }

  await updateUser(db, sessionUser.id, {
    email,
    fullName: parsed.fullName?.trim(),
  });

  const updated = await getUserById(db, sessionUser.id);
  return Response.json({ user: updated ? toPublicUser(updated) : null });
});
