import { deleteAuditReport, getDb } from "@/app/lib/db";
import {
  MissingInputError,
  ReportNotFoundError,
  isAuditError,
} from "@/app/lib/errors";

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/audits/[id]">,
) {
  try {
    const { id } = await ctx.params;
    const reportId = Number.parseInt(id, 10);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new MissingInputError("A numeric report id is required.");
    }

    const db = await getDb();
    const deleted = await deleteAuditReport(db, reportId);
    if (!deleted) {
      throw new ReportNotFoundError(reportId);
    }

    return Response.json({ deleted: true, reportId }, { status: 200 });
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
