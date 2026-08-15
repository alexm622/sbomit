import { getDb } from "@/app/lib/db";

export async function GET() {
  let dbOk = false;
  try {
    const db = await getDb();
    await db.prepare("SELECT 1").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return Response.json(
    {
      status: dbOk ? "ok" : "degraded",
      bindings: {
        db: dbOk,
        openai: Boolean(process.env.OPENAI_API_KEY),
      },
    },
    { status: dbOk ? 200 : 503 },
  );
}
