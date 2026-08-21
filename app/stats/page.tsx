"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, AlertCircle, BarChart3, FileText, Coins, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { SiteHeader } from "@/app/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { useAuth } from "@/app/lib/use-auth";

interface UserStats {
  auditsRun: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  successes: number;
  failures: number;
}

interface ReportSummary {
  id: number;
  audit_id: number;
  name: string;
  version: string;
  source: string;
  url: string;
  score: number;
  model: string;
  provider: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_total: number | null;
  created_at: string;
}

export default function StatsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = React.useState<UserStats | null>(null);
  const [reports, setReports] = React.useState<ReportSummary[]>([]);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, reportsRes] = await Promise.all([
        fetch("/api/users/me/stats"),
        fetch("/api/users/me/reports"),
      ]);
      const statsData = (await statsRes.json()) as { stats?: UserStats; error?: string };
      const reportsData = (await reportsRes.json()) as { reports?: ReportSummary[]; error?: string };
      if (!statsRes.ok || statsData.error) throw new Error(statsData.error || "Failed to load stats.");
      if (!reportsRes.ok || reportsData.error) throw new Error(reportsData.error || "Failed to load reports.");
      setStats(statsData.stats ?? null);
      setReports(reportsData.reports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [user, authLoading, router, load]);

  const toggleExpanded = React.useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (authLoading || !user) {
    return (
      <div className="flex min-h-full flex-col bg-background">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></main>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <Link href="/" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="mr-1 h-4 w-4" />Back to audits</Link>
          <div className="flex items-center gap-3"><BarChart3 className="h-6 w-6 text-primary" /><h1 className="text-3xl font-bold tracking-tight">Your statistics</h1></div>
          <p className="mt-2 text-muted-foreground">Audit activity and token usage for your account.</p>

          {error && <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><FileText className="h-4 w-4" />Audits run</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{stats?.auditsRun ?? 0}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Coins className="h-4 w-4" />Total tokens</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{(stats?.tokensTotal ?? 0).toLocaleString()}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><CheckCircle2 className="h-4 w-4" />Successes</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{stats?.successes ?? 0}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><XCircle className="h-4 w-4" />Failures</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{stats?.failures ?? 0}</div></CardContent></Card>
          </div>

          <h2 className="mt-10 text-xl font-semibold">Recent audits</h2>
          <div className="mt-4 space-y-3">
            {reports.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{r.name}@{r.version}</div>
                      <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={r.score >= 80 ? "default" : r.score >= 60 ? "secondary" : "destructive"}>{r.score}</Badge>
                      <Button type="button" variant="ghost" size="sm" onClick={() => toggleExpanded(r.id)}>
                        {expanded.has(r.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  {expanded.has(r.id) && (
                    <div className="mt-4 border-t pt-4 text-sm">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div><span className="text-muted-foreground">Source:</span> {r.source}</div>
                        <div><span className="text-muted-foreground">Model:</span> {r.model}</div>
                        <div><span className="text-muted-foreground">Provider:</span> {r.provider ?? "default"}</div>
                        <div><span className="text-muted-foreground">Tokens:</span> {(r.tokens_total ?? 0).toLocaleString()}</div>
                        <div><span className="text-muted-foreground">Input:</span> {(r.tokens_input ?? 0).toLocaleString()}</div>
                        <div><span className="text-muted-foreground">Output:</span> {(r.tokens_output ?? 0).toLocaleString()}</div>
                      </div>
                      <div className="mt-2"><span className="text-muted-foreground">URL:</span> <Link href={r.url} className="break-all text-primary hover:underline" target="_blank">{r.url}</Link></div>
                      <div className="mt-3"><Link href={`/report/${r.audit_id}`} className="text-primary hover:underline">View report</Link></div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {reports.length === 0 && !loading && <p className="text-sm text-muted-foreground">No audits yet.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
