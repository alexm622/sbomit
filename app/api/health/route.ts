import { getDb } from "@/app/lib/db";
import { getLlmConfig } from "@/app/lib/llm";
import { withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (): Promise<Response> => {
  let dbOk = false;
  try {
    const db = await getDb();
    await db.prepare("SELECT 1").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  let llmOk = false;
  let llmProvider = "none";
  try {
    const config = getLlmConfig();
    llmOk = true;
    llmProvider = config.provider;
  } catch {
    llmOk = false;
  }

  return Response.json(
    {
      status: dbOk ? "ok" : "degraded",
      bindings: {
        db: dbOk,
        llm: llmOk,
        llmProvider,
      },
    },
    { status: dbOk ? 200 : 503 },
  );
});
