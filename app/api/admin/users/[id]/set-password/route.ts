import { z } from "zod";
import { getDb, getUserById, updateUser } from "@/app/lib/db";
import { requireAdmin, hashPassword } from "@/app/lib/auth";
import { AuditError } from "@/app/lib/errors";
import {
  parseJsonBody,
  parseWithSchema,
  parseNumericId,
  withErrorHandling,
} from "@/app/lib/api";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const POST = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    const { id } = await params;
    const userId = parseNumericId(id);

    const db = await getDb();
    await requireAdmin(db, request);

    const body = await parseJsonBody(request);
    const { password } = parseWithSchema(schema, body);

    const user = await getUserById(db, userId);
    if (!user) {
      throw new AuditError("NOT_FOUND", "User not found.", 404);
    }

    const passwordHash = await hashPassword(password);
    await updateUser(db, userId, { passwordHash });

    return Response.json({ ok: true });
  },
);
