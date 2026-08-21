import { getDb, getOverallStats } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { handleApiError } from "@/app/lib/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await requireAdmin(db, request);
    const stats = await getOverallStats(db);
    return Response.json({ stats });
  } catch (error) {
    return handleApiError(error);
  }
}
