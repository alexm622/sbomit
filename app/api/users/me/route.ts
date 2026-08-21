import { z } from "zod";
import { getDb, getUserById, updateUser, getUserByEmail } from "@/app/lib/db";
import { requireAuth, toPublicUser } from "@/app/lib/auth";
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

const updateSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(100).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    const sessionUser = await requireAuth(db, request);
    const user = await getUserById(db, sessionUser.id);
    if (!user) {
      throw new AuditError("NOT_FOUND", "User not found.", 404);
    }
    return Response.json({ user: toPublicUser(user) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    const sessionUser = await requireAuth(db, request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid profile data.");
    }

    const existing = await getUserById(db, sessionUser.id);
    if (!existing) {
      throw new AuditError("NOT_FOUND", "User not found.", 404);
    }

    const email = parsed.data.email?.toLowerCase().trim();
    if (email && email !== existing.email) {
      if (await getUserByEmail(db, email)) {
        throw new AuditError("CONFLICT", "Email is already registered.", 409);
      }
    }

    await updateUser(db, sessionUser.id, {
      email,
      fullName: parsed.data.fullName?.trim(),
    });

    const updated = await getUserById(db, sessionUser.id);
    return Response.json({ user: updated ? toPublicUser(updated) : null });
  } catch (error) {
    return handleApiError(error);
  }
}
