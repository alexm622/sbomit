"use client";

import * as React from "react";
import {
  Search,
  Shield,
  AlertTriangle,
  Package,
  Scale,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Badge } from "@/app/components/ui/badge";
import { Progress } from "@/app/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/components/ui/tabs";

interface Risk {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
}

interface Dependency {
  name: string;
  version: string;
  license: string;
  transitive: boolean;
}

interface AuditResult {
  name: string;
  version: string;
  score: number;
  summary: string;
  risks: Risk[];
  dependencies: Dependency[];
  license: {
    type: string;
    compatible: boolean;
    note: string;
  };
  maintainers: string[];
  lastPublished: string;
  weeklyDownloads: string;
}

const mockAudit: AuditResult = {
  name: "lodash",
  version: "4.17.21",
  score: 82,
  summary:
    "A widely-used utility library with a long maintenance history. No known critical vulnerabilities in the current version, but it pulls in a large dependency surface and has had prototype-pollution issues in the past.",
  risks: [
    {
      severity: "medium",
      title: "Large dependency surface",
      description:
        "The package bundles many utility functions. If only a few are used, consider tree-shaking or lighter alternatives to reduce attack surface.",
    },
    {
      severity: "low",
      title: "Historical prototype pollution",
      description:
        "Older versions were affected by prototype-pollution CVEs. Current version is patched; ensure version pinning prevents regressions.",
    },
    {
      severity: "low",
      title: "Sparse recent releases",
      description:
        "The release cadence has slowed. Monitor for security patches and have an upgrade plan.",
    },
  ],
  dependencies: [
    { name: "lodash", version: "4.17.21", license: "MIT", transitive: false },
    { name: "commander", version: "2.20.3", license: "MIT", transitive: true },
    { name: "graceful-fs", version: "4.2.11", license: "ISC", transitive: true },
  ],
  license: {
    type: "MIT",
    compatible: true,
    note: "Permissive license compatible with most commercial and open-source projects. Attribution recommended.",
  },
  maintainers: ["jdalton", "mathias"],
  lastPublished: "2021-02-20",
  weeklyDownloads: "42.3M",
};

const severityVariant = {
  critical: "destructive",
  high: "destructive",
  medium: "warning",
  low: "secondary",
} as const;

const scoreVariant = (score: number) => {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
};

export default function Home() {
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<AuditResult | null>(null);
  const [activeTab, setActiveTab] = React.useState("overview");

  const handleAudit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!query.trim()) return;
      setLoading(true);
      setResult(null);
      // Simulate network + AI audit delay
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setResult({ ...mockAudit, name: query.trim() });
      setLoading(false);
      setActiveTab("overview");
    },
    [query],
  );

  return (
    <div className="flex flex-col min-h-full bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <Shield className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">sbomit</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground sm:flex">
            <a href="#" className="hover:text-foreground">
              How it works
            </a>
            <a href="#" className="hover:text-foreground">
              API
            </a>
            <a href="#" className="hover:text-foreground">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              AI audit for npm libraries
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Search any package and get an instant security, license, and
              dependency report powered by AI.
            </p>

            <form
              onSubmit={handleAudit}
              className="mt-10 flex flex-col gap-3 sm:flex-row"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. lodash, express, axios"
                  className="h-14 pl-10 text-base"
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !query.trim()}
                className="h-14 px-8 text-base"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Auditing
                  </>
                ) : (
                  <>
                    Audit Package
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>Try:</span>
              {["lodash", "express", "axios", "react"].map((pkg) => (
                <button
                  key={pkg}
                  type="button"
                  onClick={() => setQuery(pkg)}
                  className="rounded-full border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                >
                  {pkg}
                </button>
              ))}
            </div>
          </div>
        </section>

        {result && (
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-6">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="risks">
                  Risks
                  <Badge variant="secondary" className="ml-2">
                    {result.risks.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
                <TabsTrigger value="license">License</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>Trust Score</CardDescription>
                      <div className="flex items-end gap-2">
                        <CardTitle className="text-4xl">
                          {result.score}
                        </CardTitle>
                        <span className="text-sm text-muted-foreground">
                          /100
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Progress
                        value={result.score}
                        variant={scoreVariant(result.score)}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>Version</CardDescription>
                      <CardTitle className="text-2xl">
                        {result.version}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Last published {result.lastPublished}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>Weekly Downloads</CardDescription>
                      <CardTitle className="text-2xl">
                        {result.weeklyDownloads}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        npm registry estimate
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>License</CardDescription>
                      <CardTitle className="text-2xl">
                        {result.license.type}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {result.license.compatible
                          ? "Compatible"
                          : "Review required"}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Info className="h-5 w-5 text-muted-foreground" />
                      AI Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-base leading-7 text-foreground">
                    {result.summary}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="risks" className="space-y-4">
                {result.risks.map((risk, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 text-amber-500" />
                          <CardTitle className="text-lg">{risk.title}</CardTitle>
                        </div>
                        <Badge variant={severityVariant[risk.severity]}>
                          {risk.severity}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground">{risk.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="dependencies">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-muted-foreground" />
                      Dependency Tree
                    </CardTitle>
                    <CardDescription>
                      Direct and transitive dependencies identified by the audit.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              Package
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              Version
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              License
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              Type
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {result.dependencies.map((dep) => (
                            <tr key={`${dep.name}@${dep.version}`}>
                              <td className="px-4 py-3 font-medium">
                                {dep.name}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {dep.version}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="outline">{dep.license}</Badge>
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {dep.transitive ? "Transitive" : "Direct"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="license">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Scale className="h-5 w-5 text-muted-foreground" />
                      License Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-lg font-semibold">
                          {result.license.type} License
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {result.license.compatible
                            ? "Compatible with most projects"
                            : "May conflict with your project license"}
                        </p>
                      </div>
                    </div>
                    <p className="text-muted-foreground leading-7">
                      {result.license.note}
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>
        )}
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          sbomit — AI-powered npm audits. Built for safer dependencies.
        </div>
      </footer>
    </div>
  );
}
