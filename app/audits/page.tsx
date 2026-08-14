"use client";

import * as React from "react";
import {
  AlertTriangle,
  Clock,
  History,
  Loader2,
  MessageSquare,
  Package,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { SiteHeader } from "@/app/components/site-header";
import {
  ElapsedTime,
  displayUrlLabel,
  useAuditJobs,
  type AuditJob,
} from "@/app/components/audit-jobs";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

interface AuditHistoryItem {
  id: number;
  audit_id: number;
  prompt: string | null;
  model: string;
  score: number;
  created_at: string;
  name: string;
  version: string;
  source: string;
  url: string;
}

const scoreBadgeVariant = (score: number) => {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "destructive";
};

const jobStatusBadge: Record<
  AuditJob["status"],
  { variant: "secondary" | "success" | "destructive" | "outline"; label: string }
> = {
  running: { variant: "secondary", label: "Running" },
  completed: { variant: "success", label: "Completed" },
  failed: { variant: "destructive", label: "Failed" },
  cancelled: { variant: "outline", label: "Cancelled" },
};

function formatTimestamp(createdAt: string): string {
  // SQLite CURRENT_TIMESTAMP is UTC ("YYYY-MM-DD HH:MM:SS").
  const date = new Date(`${createdAt.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString();
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString();
}

function formatDuration(startedAt: number, finishedAt?: number): string {
  if (!finishedAt) return "";
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function AuditsPage() {
  const { jobs, cancelAudit, dismissJob } = useAuditJobs();
  const [history, setHistory] = React.useState<AuditHistoryItem[] | null>(
    null,
  );
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<number | null>(
    null,
  );
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  const completedCount = jobs.filter(
    (job) => job.status === "completed",
  ).length;

  const fetchHistory = React.useCallback(async () => {
    try {
      const res = await fetch("/api/audits", { cache: "no-store" });
      const data = (await res.json()) as {
        audits?: AuditHistoryItem[];
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load audit history.");
      }
      setHistory(data.audits ?? []);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "Failed to load audit history.",
      );
    }
  }, []);

  // Load on mount and reload whenever a running audit completes.
  React.useEffect(() => {
    const timer = setTimeout(() => void fetchHistory(), 0);
    return () => clearTimeout(timer);
  }, [fetchHistory, completedCount]);

  // Auto-reset the delete confirmation after a few seconds.
  React.useEffect(() => {
    if (confirmDeleteId === null) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  const handleDelete = React.useCallback(
    async (reportId: number) => {
      if (confirmDeleteId !== reportId) {
        setConfirmDeleteId(reportId);
        return;
      }
      setDeletingId(reportId);
      try {
        const res = await fetch(`/api/audits/${reportId}`, {
          method: "DELETE",
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to delete audit.");
        }
        setHistory((prev) =>
          prev ? prev.filter((item) => item.id !== reportId) : prev,
        );
      } catch (error) {
        setHistoryError(
          error instanceof Error ? error.message : "Failed to delete audit.",
        );
      } finally {
        setDeletingId(null);
        setConfirmDeleteId(null);
      }
    },
    [confirmDeleteId],
  );

  return (
    <div className="flex min-h-full flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Audits</h1>
            <p className="mt-2 text-muted-foreground">
              Track audits in progress and browse or remove past audit reports.
            </p>
          </div>

          <div className="mb-10">
            <div className="mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold">In progress</h2>
            </div>

            {jobs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No audits running in this session. Start one from the home
                  page — it keeps running even if you navigate away.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => {
                  const status = jobStatusBadge[job.status];
                  return (
                    <Card key={job.id}>
                      <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {job.status === "running" && (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            <span className="truncate font-medium">
                              {displayUrlLabel(job.libraryUrl)}
                            </span>
                            <Badge variant="outline">{job.source}</Badge>
                            <Badge variant={status.variant}>
                              {status.label}
                            </Badge>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Started {formatTime(job.startedAt)}
                            {job.status === "running" ? (
                              <>
                                {" "}
                                · elapsed{" "}
                                <ElapsedTime
                                  since={job.startedAt}
                                  className="tabular-nums"
                                />
                              </>
                            ) : (
                              <> · took {formatDuration(job.startedAt, job.finishedAt)}</>
                            )}
                          </div>
                          {job.prompt && (
                            <div className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="line-clamp-1">{job.prompt}</span>
                            </div>
                          )}
                          {job.status === "failed" && job.error && (
                            <div className="mt-1 text-sm text-red-600 dark:text-red-400">
                              {job.error}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {job.status === "running" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => cancelAudit(job.id)}
                            >
                              <XCircle className="mr-1.5 h-4 w-4" />
                              Cancel
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => dismissJob(job.id)}
                              aria-label="Dismiss"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-xl font-semibold">History</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchHistory()}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Refresh
              </Button>
            </div>

            {historyError && (
              <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>{historyError}</p>
              </div>
            )}

            {history === null && !historyError && (
              <Card>
                <CardContent className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading audit history...
                </CardContent>
              </Card>
            )}

            {history !== null && history.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No audit reports stored yet. Completed audits are saved to D1
                  and listed here.
                </CardContent>
              </Card>
            )}

            {history !== null && history.length > 0 && (
              <div className="space-y-3">
                {history.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate font-medium">
                            {item.name}
                            <span className="font-normal text-muted-foreground">
                              @{item.version}
                            </span>
                          </span>
                          <Badge variant="outline">{item.source}</Badge>
                          <Badge variant={scoreBadgeVariant(item.score)}>
                            score {item.score}
                          </Badge>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {formatTimestamp(item.created_at)} · {item.model} ·
                          report #{item.id}
                        </div>
                        {item.prompt && (
                          <div className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="line-clamp-1">{item.prompt}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant={
                            confirmDeleteId === item.id
                              ? "destructive"
                              : "outline"
                          }
                          size="sm"
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item.id)}
                        >
                          {deletingId === item.id ? (
                            <>
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                              Deleting
                            </>
                          ) : confirmDeleteId === item.id ? (
                            <>
                              <AlertTriangle className="mr-1.5 h-4 w-4" />
                              Confirm delete
                            </>
                          ) : (
                            <>
                              <Trash2 className="mr-1.5 h-4 w-4" />
                              Delete
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          sbomit — AI-powered npm audits. Built for safer dependencies.
        </div>
      </footer>
    </div>
  );
}
