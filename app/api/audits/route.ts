import { getDb, listAuditReports } from "@/app/lib/db";
import { isAuditError } from "@/app/lib/errors";

export async function GET() {
  try {
    const db = await getDb();
    const audits = await listAuditReports(db);
    return Response.json({ audits }, { status: 200 });
  } catch (error) {
    if (isAuditError(error)) {
      return Response.json(error.toJSON(), { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return Response.json(
      { error: message, code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
