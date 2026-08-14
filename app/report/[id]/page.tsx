import { notFound } from "next/navigation";
import { getDb, getReportByPublicId } from "@/app/lib/db";
import { auditResultSchema } from "@/app/lib/audit";
import { ReportView } from "@/app/components/report-view";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getDb();
  const report = await getReportByPublicId(db, id);

  if (!report) {
    notFound();
  }

  const parsed = auditResultSchema.safeParse(JSON.parse(report.result_json));
  if (!parsed.success) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background">
      <ReportView
        report={{
          id: report.public_id,
          model: report.model,
          score: report.score,
          createdAt: report.created_at,
          result: parsed.data,
        }}
      />
    </main>
  );
}
