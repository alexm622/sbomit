import { getDb, getUserById } from "@/app/lib/db";
import { requireAdmin, createPasswordResetToken } from "@/app/lib/auth";
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

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

    const user = await getUserById(db, userId);
    if (!user) {
      throw new AuditError("NOT_FOUND", "User not found.", 404);
    }

    const token = await createPasswordResetToken(db, userId);
    return Response.json({ token });
  } catch (error) {
    return handleApiError(error);
  }
}
