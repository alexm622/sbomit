import { z } from "zod";
import {
  getDb,
  listBlockedEmails,
  addBlockedEmail,
  removeBlockedEmail,
} from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { MissingInputError } from "@/app/lib/errors";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const schema = z.object({
  email: z.string().email(),
});

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);
  const emails = await listBlockedEmails(db);
  return Response.json({ emails });
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);

  const body = await parseJsonBody(request);
  const { email } = parseWithSchema(schema, body);

  await addBlockedEmail(db, email.toLowerCase().trim());
  const emails = await listBlockedEmails(db);
  return Response.json({ emails }, { status: 201 });
});

export const DELETE = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.toLowerCase().trim();
  if (!email) {
    throw new MissingInputError("Email is required.");
  }

  await removeBlockedEmail(db, email);
  const emails = await listBlockedEmails(db);
  return Response.json({ emails });
});
