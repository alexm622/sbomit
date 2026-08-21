import { getDb, getUserStats } from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import { handleApiError } from "@/app/lib/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    const user = await requireAuth(db, request);
    const stats = await getUserStats(db, user.id);
    return Response.json({ stats });
  } catch (error) {
    return handleApiError(error);
  }
}
