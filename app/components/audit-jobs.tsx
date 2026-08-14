"use client";

import * as React from "react";
import type { AuditResult } from "@/app/lib/audit";

export type AuditJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface AuditJob {
  id: string;
  libraryUrl: string;
  source: "npm" | "github";
  prompt?: string;
  status: AuditJobStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface AuditJobMeta {
  cached: boolean;
  auditId: number;
  reportId: number;
}

export type AuditOutcome =
  | { status: "completed"; result: AuditResult; meta: AuditJobMeta }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

export interface StartAuditHandle {
  jobId: string;
  done: Promise<AuditOutcome>;
}

interface AuditJobsContextValue {
  jobs: AuditJob[];
  startAudit(input: { libraryUrl: string; prompt?: string }): StartAuditHandle;
  cancelAudit(jobId: string): void;
  dismissJob(jobId: string): void;
}

const AuditJobsContext = React.createContext<AuditJobsContextValue | null>(
  null,
);

function createJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sourceFromUrl(url: string): "npm" | "github" {
  return url.includes("github.com") ? "github" : "npm";
}

export function displayUrlLabel(url: string): string {
  return url
    .replace("https://www.npmjs.com/package/", "npm:")
    .replace("https://github.com/", "gh:");
}

export function AuditJobsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = React.useState<AuditJob[]>([]);
  const abortControllers = React.useRef(new Map<string, AbortController>());

  const updateJob = React.useCallback(
    (jobId: string, patch: Partial<AuditJob>) => {
      setJobs((prev) =>
        prev.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
      );
    },
    [],
  );

  const startAudit = React.useCallback(
    (input: { libraryUrl: string; prompt?: string }): StartAuditHandle => {
      const jobId = createJobId();
      const controller = new AbortController();
      abortControllers.current.set(jobId, controller);

      const job: AuditJob = {
        id: jobId,
        libraryUrl: input.libraryUrl,
        source: sourceFromUrl(input.libraryUrl),
        prompt: input.prompt,
        status: "running",
        startedAt: Date.now(),
      };
      setJobs((prev) => [job, ...prev]);

      const done = (async (): Promise<AuditOutcome> => {
        try {
          const res = await fetch("/api/audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              libraryUrl: input.libraryUrl,
              prompt: input.prompt,
            }),
            signal: controller.signal,
          });

          const data = (await res.json()) as {
            result?: AuditResult;
            meta?: AuditJobMeta;
            error?: string;
          };

          if (!res.ok || data.error) {
            throw new Error(data.error || "Audit failed.");
          }
          if (!data.result) {
            throw new Error("No audit result returned.");
          }

          updateJob(jobId, { status: "completed", finishedAt: Date.now() });
          return {
            status: "completed",
            result: data.result,
            meta: data.meta ?? { cached: false, auditId: 0, reportId: 0 },
          };
        } catch (error) {
          if (controller.signal.aborted) {
            updateJob(jobId, {
              status: "cancelled",
              finishedAt: Date.now(),
            });
            return { status: "cancelled" };
          }
          const message =
            error instanceof Error ? error.message : "Something went wrong.";
          updateJob(jobId, {
            status: "failed",
            finishedAt: Date.now(),
            error: message,
          });
          return { status: "failed", error: message };
        } finally {
          abortControllers.current.delete(jobId);
        }
      })();

      return { jobId, done };
    },
    [updateJob],
  );

  const cancelAudit = React.useCallback((jobId: string) => {
    abortControllers.current.get(jobId)?.abort();
  }, []);

  const dismissJob = React.useCallback((jobId: string) => {
    abortControllers.current.get(jobId)?.abort();
    setJobs((prev) => prev.filter((job) => job.id !== jobId));
  }, []);

  const value = React.useMemo(
    () => ({ jobs, startAudit, cancelAudit, dismissJob }),
    [jobs, startAudit, cancelAudit, dismissJob],
  );

  return (
    <AuditJobsContext.Provider value={value}>
      {children}
    </AuditJobsContext.Provider>
  );
}

export function useAuditJobs(): AuditJobsContextValue {
  const ctx = React.useContext(AuditJobsContext);
  if (!ctx) {
    throw new Error("useAuditJobs must be used within AuditJobsProvider.");
  }
  return ctx;
}

export function ElapsedTime({
  since,
  className,
}: {
  since: number;
  className?: string;
}) {
  const [elapsedMs, setElapsedMs] = React.useState(0);

  React.useEffect(() => {
    const tick = () => setElapsedMs(Math.max(0, Date.now() - since));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return (
    <span className={className}>
      {minutes}:{seconds}
    </span>
  );
}
