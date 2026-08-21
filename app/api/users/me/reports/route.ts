import { getDb, listUserAuditReports } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import { handleApiError } from "@/app/lib/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    const user = await requireAuth(db, request);
    const reports = await listUserAuditReports(db, user.id);
    return Response.json({ reports });
  } catch (error) {
    return handleApiError(error);
  }
}
