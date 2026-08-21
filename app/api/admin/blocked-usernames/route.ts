import { z } from "zod";
import {
  getDb,
  listBlockedUsernames,
  addBlockedUsername,
  removeBlockedUsername,
} from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { handleApiError, MissingInputError } from "@/app/lib/errors";

const schema = z.object({
  username: z.string().min(1),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await requireAdmin(db, request);
    const usernames = await listBlockedUsernames(db);
    return Response.json({ usernames });
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
      throw new MissingInputError(first?.message ?? "Invalid username.");
    }

    await addBlockedUsername(db, parsed.data.username.toLowerCase().trim());
    const usernames = await listBlockedUsernames(db);
    return Response.json({ usernames }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await requireAdmin(db, request);

    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username")?.toLowerCase().trim();
    if (!username) {
      throw new MissingInputError("Username is required.");
    }

    await removeBlockedUsername(db, username);
    const usernames = await listBlockedUsernames(db);
    return Response.json({ usernames });
  } catch (error) {
    return handleApiError(error);
  }
}
