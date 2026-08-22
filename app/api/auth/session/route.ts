import { getDb } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth";
import { withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  const user = await getSessionUser(db, request);
  if (!user) {
    return Response.json({ user: null }, { status: 401 });
  }
  return Response.json({ user });
});
