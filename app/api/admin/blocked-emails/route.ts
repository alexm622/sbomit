import { z } from "zod";
import {
  getDb,
  listBlockedEmails,
  addBlockedEmail,
  removeBlockedEmail,
} from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { handleApiError, MissingInputError } from "@/app/lib/errors";

const schema = z.object({
  email: z.string().email(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await requireAdmin(db, request);
    const emails = await listBlockedEmails(db);
    return Response.json({ emails });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
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
      throw new MissingInputError(first?.message ?? "Invalid email.");
    }

    await addBlockedEmail(db, parsed.data.email.toLowerCase().trim());
    const emails = await listBlockedEmails(db);
    return Response.json({ emails }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
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
  } catch (error) {
    return handleApiError(error);
  }
}
