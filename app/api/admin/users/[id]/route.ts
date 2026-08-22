import { z } from "zod";
import {
  getDb,
  getUserById,
  updateUser,
  deleteUser,
  isEmailBlocked,
  getUserByEmail,
} from "@/app/lib/db";
import { requireAdmin, toPublicUser } from "@/app/lib/auth";
import { AuditError } from "@/app/lib/errors";
import {
  parseJsonBody,
  parseWithSchema,
  parseNumericId,
  withErrorHandling,
} from "@/app/lib/api";

const updateSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(100).optional(),
  isAdmin: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
});

export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    const { id } = await params;
    const userId = parseNumericId(id);

    const db = await getDb();
    await requireAdmin(db, request);

    const user = await getUserById(db, userId);
    if (!user) {
      return Response.json({ error: "User not found.", code: "NOT_FOUND" }, { status: 404 });
    }

    return Response.json({ user: toPublicUser(user) });
  },
);

export const PUT = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    const { id } = await params;
    const userId = parseNumericId(id);

    const db = await getDb();
    await requireAdmin(db, request);

    const body = await parseJsonBody(request);
    const data = parseWithSchema(updateSchema, body);

    const existing = await getUserById(db, userId);
    if (!existing) {
      return Response.json({ error: "User not found.", code: "NOT_FOUND" }, { status: 404 });
    }

    const email = data.email?.toLowerCase().trim();
    if (email && email !== existing.email) {
      if (await isEmailBlocked(db, email)) {
        throw new AuditError("FORBIDDEN", "This email is blocked.", 400);
      }
      if (await getUserByEmail(db, email)) {
        throw new AuditError("CONFLICT", "Email is already registered.", 409);
      }
    }

    await updateUser(db, userId, {
      email,
      fullName: data.fullName?.trim(),
      isAdmin: data.isAdmin,
      isBlocked: data.isBlocked,
    });

    const updated = await getUserById(db, userId);
    return Response.json({ user: updated ? toPublicUser(updated) : null });
  },
);

export const DELETE = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    const { id } = await params;
    const userId = parseNumericId(id);

    const db = await getDb();
    const admin = await requireAdmin(db, request);
    if (admin.id === userId) {
      throw new AuditError("FORBIDDEN", "You cannot delete your own account.", 400);
    }

    const deleted = await deleteUser(db, userId);
    if (!deleted) {
      return Response.json({ error: "User not found.", code: "NOT_FOUND" }, { status: 404 });
    }

    return Response.json({ ok: true });
  },
);
