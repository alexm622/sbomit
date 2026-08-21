"use client";

import * as React from "react";
import { Bot, Scale, XCircle } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/app/components/ui/card";
import { ReportView } from "@/app/components/report-view";
import type { AuditResult, CompetitionReadout } from "@/app/lib/audit";
import type { ProviderConfig } from "@/app/lib/providers";

function providerName(
  configs: ProviderConfig[],
  provider?: string,
): string {
  if (!provider) return "unknown";
  const config =
    configs.find((c) => c.id === provider) ??
    configs.find((c) => c.provider === provider);
  return config?.name ?? provider;
}

function CompactAuditCard({
  label,
  provider,
  model,
  result,
}: {
  label: string;
  provider: string;
  model: string;
  result: AuditResult;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">{label}</CardTitle>
            <CardDescription>
              {provider} · {model}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="text-xl font-bold">{result.score}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Findings</p>
            <p className="text-xl font-bold">
              {result.risks.length + result.deepDiveFindings.length}
            </p>
          </div>
        </div>
        {result.summary && (
          <p className="text-sm text-muted-foreground">{result.summary}</p>
        )}
        {result.risks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Top risks
            </p>
            {result.risks.slice(0, 3).map((risk, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between gap-2 rounded-lg border p-2 text-sm"
              >
                <span className="line-clamp-2">{risk.title}</span>
                <Badge variant={risk.severity === "critical" || risk.severity === "high" ? "destructive" : "secondary"}>
                  {risk.severity}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExclusionsPanel({
  exclusions,
}: {
  exclusions: CompetitionReadout["exclusions"];
}) {
  if (exclusions.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Scale className="h-4 w-4" />
          The judge did not exclude any findings.
        </CardContent>
      </Card>
    );
  }

  const typeLabel: Record<(typeof exclusions)[number]["type"], string> = {
    risk: "Risk",
    investigationArea: "Investigation area",
    deepDiveFinding: "Deep-dive finding",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <XCircle className="h-4 w-4 text-destructive" />
          Excluded by judge ({exclusions.length})
        </CardTitle>
        <CardDescription>
          Findings removed during the merge step, with the judge&apos;s reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {exclusions.map((exclusion, idx) => (
          <div
            key={idx}
            className="rounded-lg border bg-background p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{typeLabel[exclusion.type]}</Badge>
              <Badge variant="secondary">Model {exclusion.fromModel}</Badge>
            </div>
            <p className="mt-1.5 font-medium">{exclusion.titleOrFile}</p>
            <p className="text-muted-foreground">{exclusion.reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function CompetitionReadoutView({
  result,
  configs,
}: {
  result: AuditResult;
  configs: ProviderConfig[];
}) {
  const readout = result.competitionReadout;
  if (!readout) return null;

  const modelAProvider = providerName(configs, readout.modelA.provider);
  const modelBProvider = providerName(configs, readout.modelB.provider);
  const judgeProvider = providerName(configs, readout.judge.provider);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <CompactAuditCard
          label="Model A"
          provider={modelAProvider}
          model={readout.modelA.model}
          result={readout.modelA.result}
        />
        <CompactAuditCard
          label="Model B"
          provider={modelBProvider}
          model={readout.modelB.model}
          result={readout.modelB.result}
        />
      </div>

      <div className="mx-auto max-w-3xl">
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <div className="flex items-center justify-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Scale className="h-4 w-4" />
              </div>
              <div className="text-center">
                <CardTitle className="text-base">Judge merged report</CardTitle>
                <CardDescription>
                  {judgeProvider} · {readout.judge.model}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ReportView result={result} />
          </CardContent>
        </Card>
      </div>

      <ExclusionsPanel exclusions={readout.exclusions} />
    </div>
  );
}
