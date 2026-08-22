import { getDb, getOverallStats } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);
  const stats = await getOverallStats(db);
  return Response.json({ stats });
});
