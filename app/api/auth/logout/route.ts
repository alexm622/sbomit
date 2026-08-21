import { getDb } from "@/app/lib/db";
import { deleteSession, authResponse } from "@/app/lib/auth";
import { handleApiError } from "@/app/lib/errors";

export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await deleteSession(db, request);
    return authResponse({ ok: true }, { clearCookie: "sbomit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  } catch (error) {
    return handleApiError(error);
  }
}
