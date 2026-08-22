import { z } from "zod";
import { getDb, getUserByEmail } from "@/app/lib/db";
import { createPasswordResetToken } from "@/app/lib/auth";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const requestSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);
  const { email } = parseWithSchema(requestSchema, body);
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
});
