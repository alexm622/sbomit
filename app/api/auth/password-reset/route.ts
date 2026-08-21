import { z } from "zod";
import { getDb, getUserByEmail } from "@/app/lib/db";
import { createPasswordResetToken } from "@/app/lib/auth";
import { handleApiError, MissingInputError } from "@/app/lib/errors";

const requestSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid email.");
    }

    const { email } = parsed.data;
    const db = await getDb();
    const user = await getUserByEmail(db, email.toLowerCase().trim());

    // Always return success so the endpoint does not leak whether the email exists.
    if (user) {
      await createPasswordResetToken(db, user.id);
      // In a real deployment, send an email here. For now the token is created
      // and an admin can retrieve it or the user flow can be completed with the
      // raw token from the database during development.
    }

    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
