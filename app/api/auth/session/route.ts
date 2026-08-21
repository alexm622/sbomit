import { getDb } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth";
import { handleApiError } from "@/app/lib/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    const user = await getSessionUser(db, request);
    if (!user) {
      return Response.json({ user: null }, { status: 401 });
    }
    return Response.json({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
