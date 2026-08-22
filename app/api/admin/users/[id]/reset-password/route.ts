import { getDb, getUserById } from "@/app/lib/db";
import { requireAdmin, createPasswordResetToken } from "@/app/lib/auth";
import { AuditError } from "@/app/lib/errors";
import { parseNumericId, withErrorHandling } from "@/app/lib/api";

export const POST = withErrorHandling(
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
      throw new AuditError("NOT_FOUND", "User not found.", 404);
    }

    const token = await createPasswordResetToken(db, userId);
    return Response.json({ token });
  },
);
