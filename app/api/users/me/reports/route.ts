import { getDb, listUserAuditReports } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import { withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  const user = await requireAuth(db, request);
  const reports = await listUserAuditReports(db, user.id);
  return Response.json({ reports });
});
