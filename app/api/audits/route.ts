import { getDb, listAuditReports } from "@/app/lib/db";
import { withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (): Promise<Response> => {
  const db = await getDb();
  const audits = await listAuditReports(db);
  return Response.json({ audits }, { status: 200 });
});
