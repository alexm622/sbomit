import { getDb, getUserStats } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import { withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  const user = await requireAuth(db, request);
  const stats = await getUserStats(db, user.id);
  return Response.json({ stats });
});
