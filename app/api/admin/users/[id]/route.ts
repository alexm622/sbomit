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
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

const updateSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(100).optional(),
  isAdmin: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      throw new MissingInputError("Invalid user id.");
    }

    const db = await getDb();
    await requireAdmin(db, request);

    const user = await getUserById(db, userId);
    if (!user) {
      return Response.json({ error: "User not found.", code: "NOT_FOUND" }, { status: 404 });
    }

    return Response.json({ user: toPublicUser(user) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      throw new MissingInputError("Invalid user id.");
    }

    const db = await getDb();
    await requireAdmin(db, request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid user data.");
    }

    const existing = await getUserById(db, userId);
    if (!existing) {
      return Response.json({ error: "User not found.", code: "NOT_FOUND" }, { status: 404 });
    }

    const email = parsed.data.email?.toLowerCase().trim();
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
      fullName: parsed.data.fullName?.trim(),
      isAdmin: parsed.data.isAdmin,
      isBlocked: parsed.data.isBlocked,
    });

    const updated = await getUserById(db, userId);
    return Response.json({ user: updated ? toPublicUser(updated) : null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      throw new MissingInputError("Invalid user id.");
    }

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
  } catch (error) {
    return handleApiError(error);
  }
}
