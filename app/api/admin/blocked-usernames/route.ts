import { z } from "zod";
import {
  getDb,
  listBlockedUsernames,
  addBlockedUsername,
  removeBlockedUsername,
} from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { MissingInputError } from "@/app/lib/errors";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const schema = z.object({
  username: z.string().min(1),
});

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);
  const usernames = await listBlockedUsernames(db);
  return Response.json({ usernames });
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);

  const body = await parseJsonBody(request);
  const { username } = parseWithSchema(schema, body);

  await addBlockedUsername(db, username.toLowerCase().trim());
  const usernames = await listBlockedUsernames(db);
  return Response.json({ usernames }, { status: 201 });
});

export const DELETE = withErrorHandling(async (request: Request): Promise<Response> => {
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
});
