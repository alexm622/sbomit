import { getDb } from "@/app/lib/db";
import { deleteSession, authResponse } from "@/app/lib/auth";
import { withErrorHandling } from "@/app/lib/api";

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await deleteSession(db, request);
  return authResponse({ ok: true }, { clearCookie: "sbomit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
});
