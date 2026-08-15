"use client";

import * as React from "react";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import type { AuditResult } from "@/app/lib/audit";

const severityBadgeVariant = (
  severity: "critical" | "high" | "medium" | "low",
) => {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  return "secondary";
};

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

export function ReportView({ result }: { result: AuditResult }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Score</div>
            <div className="text-2xl font-bold">{result.score}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Version</div>
            <div className="text-lg font-semibold">{result.version}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Downloads / week</div>
            <div className="text-lg font-semibold">{result.weeklyDownloads}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">License</div>
            <div className="text-lg font-semibold">{result.license.type}</div>
          </CardContent>
        </Card>
      </div>

      {result.summary && (
        <ReportSection title="Summary">
          <p className="text-sm leading-6 text-foreground">{result.summary}</p>
        </ReportSection>
      )}

      {result.investigationAreas.length > 0 && (
        <ReportSection
          title={`Investigation areas (${result.investigationAreas.length})`}
        >
          <div className="space-y-2">
            {result.investigationAreas.map((area, idx) => (
              <div
                key={idx}
                className="rounded-lg border bg-background p-3 text-sm"
              >
                <p className="font-medium">{area.area}</p>
                <p className="text-muted-foreground">{area.rationale}</p>
                {area.files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {area.files.map((file) => (
                      <Badge key={file} variant="outline">
                        {file}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {result.risks.length > 0 && (
        <ReportSection title={`Risks (${result.risks.length})`}>
          <div className="space-y-2">
            {result.risks.map((risk, idx) => (
              <div
                key={idx}
                className="rounded-lg border bg-background p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{risk.title}</p>
                  <Badge variant={severityBadgeVariant(risk.severity)}>
                    {risk.severity}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{risk.description}</p>
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {result.deepDiveFindings.length > 0 && (
        <ReportSection
          title={`Deep-dive findings (${result.deepDiveFindings.length})`}
        >
          <div className="space-y-2">
            {result.deepDiveFindings.map((finding, idx) => (
              <div
                key={idx}
                className="rounded-lg border bg-background p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{finding.file}</p>
                  <Badge variant={severityBadgeVariant(finding.severity)}>
                    {finding.severity}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{finding.area}</p>
                <p className="mt-1 font-medium">{finding.issue}</p>
                {finding.evidence && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                    {finding.evidence}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {result.cves.length > 0 && (
        <ReportSection title={`CVEs (${result.cves.length})`}>
          <div className="space-y-2">
            {result.cves.map((cve, idx) => (
              <div
                key={idx}
                className="rounded-lg border bg-background p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{cve.id}</p>
                  {cve.severity && (
                    <Badge variant={severityBadgeVariant(cve.severity)}>
                      {cve.severity}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-muted-foreground">{cve.title}</p>
                <p className="mt-1">{cve.description}</p>
                {cve.fixedVersion && (
                  <p className="mt-1 text-muted-foreground">
                    Fixed in: {cve.fixedVersion}
                  </p>
                )}
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {result.dependencies.length > 0 && (
        <ReportSection title={`Dependencies (${result.dependencies.length})`}>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Package</th>
                  <th className="px-3 py-2 text-left font-medium">Version</th>
                  <th className="px-3 py-2 text-left font-medium">License</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.dependencies.map((dep) => (
                  <tr key={`${dep.name}@${dep.version}`}>
                    <td className="px-3 py-2 font-medium">{dep.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {dep.version}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{dep.license}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {dep.transitive ? "Transitive" : "Direct"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReportSection>
      )}
    </div>
  );
}
