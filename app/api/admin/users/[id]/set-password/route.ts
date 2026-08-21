import { z } from "zod";
import { getDb, getUserById, updateUser } from "@/app/lib/db";
import { requireAdmin, hashPassword } from "@/app/lib/auth";
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(
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

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid password.");
    }

    const user = await getUserById(db, userId);
    if (!user) {
      throw new AuditError("NOT_FOUND", "User not found.", 404);
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await updateUser(db, userId, { passwordHash });

    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
