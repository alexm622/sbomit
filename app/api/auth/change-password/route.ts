import { z } from "zod";
import { getDb, getUserById, updateUser } from "@/app/lib/db";
import { requireAuth, verifyPassword, hashPassword, authResponse } from "@/app/lib/auth";
import { handleApiError, MissingInputError } from "@/app/lib/errors";

const changeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    const user = await requireAuth(db, request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = changeSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid password data.");
    }

    const { currentPassword, newPassword } = parsed.data;

    const stored = await getUserById(db, user.id);
    if (!stored) {
      throw new MissingInputError("User not found.");
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
  } catch (error) {
    return handleApiError(error);
  }
}
