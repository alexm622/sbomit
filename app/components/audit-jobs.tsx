"use client";

import * as React from "react";
import type { AuditResult } from "@/app/lib/audit";
import type { LlmInteraction } from "@/app/lib/llm";
import type { AuditEvent, AuditStep } from "@/app/lib/run-audit";

export type AuditJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface AuditJob {
  id: string;
  libraryUrl: string;
  version?: string;
  source: "npm" | "github";
  prompt?: string;
  status: AuditJobStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  codebaseInspected?: boolean;
  interactions?: LlmInteraction[];
  currentStep?: AuditStep;
  completedSteps?: AuditStep[];
  tokensPerSecond?: number;
  lastLlmPhase?: string;
  estimatedFinishAt?: number;
  downloadDetail?: string;
}

export interface AuditJobMeta {
  cached: boolean;
  auditId: number;
  reportId: number;
  codebaseInspected?: boolean;
  interactions?: LlmInteraction[];
}

export type AuditOutcome =
  | { status: "completed"; result: AuditResult; meta: AuditJobMeta }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

export interface StartAuditHandle {
  jobId: string;
  done: Promise<AuditOutcome>;
}

export interface AuditLlmConfig {
  providerId: string;
  model: string;
}

interface AuditJobsContextValue {
  jobs: AuditJob[];
  startAudit(input: {
    libraryUrl: string;
    version?: string;
    prompt?: string;
    llmConfig?: AuditLlmConfig;
  }): StartAuditHandle;
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
    (
      jobId: string,
      patch: Partial<AuditJob> | ((job: AuditJob) => Partial<AuditJob>),
    ) => {
      setJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) return job;
          const applied = typeof patch === "function" ? patch(job) : patch;
          return { ...job, ...applied };
        }),
      );
    },
    [],
  );

  const startAudit = React.useCallback(
    (input: {
      libraryUrl: string;
      version?: string;
      prompt?: string;
      llmConfig?: AuditLlmConfig;
    }): StartAuditHandle => {
      const jobId = createJobId();
      const controller = new AbortController();
      abortControllers.current.set(jobId, controller);

      const job: AuditJob = {
        id: jobId,
        libraryUrl: input.libraryUrl,
        version: input.version,
        source: sourceFromUrl(input.libraryUrl),
        prompt: input.prompt,
        status: "running",
        startedAt: Date.now(),
        completedSteps: [],
      };
      setJobs((prev) => [job, ...prev]);

      const done = (async (): Promise<AuditOutcome> => {
        try {
          const body: Record<string, unknown> = {
            libraryUrl: input.libraryUrl,
          };
          if (input.version) body.version = input.version;
          if (input.prompt) body.prompt = input.prompt;
          if (input.llmConfig) {
            body.providerId = input.llmConfig.providerId;
            body.model = input.llmConfig.model;
          }

          const res = await fetch("/api/audit/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            throw new Error("Audit stream failed to start.");
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let finalOutcome: AuditOutcome | undefined;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;
              const event = JSON.parse(line) as
                | AuditEvent
                | { type: "complete"; result: AuditResult; meta: AuditJobMeta }
                | { type: "error"; error: { error: string; code: string } };

              if (event.type === "complete") {
                finalOutcome = {
                  status: "completed",
                  result: event.result,
                  meta: event.meta,
                };
              } else if (event.type === "error") {
                throw new Error(event.error.error);
              } else if (event.type === "step") {
                updateJob(jobId, (prev) => {
                  const completed = new Set(prev.completedSteps ?? []);
                  if (event.status === "completed") {
                    completed.add(event.step);
                  }
                  return {
                    currentStep:
                      event.status === "started" ? event.step : undefined,
                    completedSteps: Array.from(completed),
                    downloadDetail:
                      event.step === "download" && event.status === "completed"
                        ? event.detail
                        : prev.downloadDetail,
                  };
                });
              } else if (event.type === "llm") {
                updateJob(jobId, {
                  tokensPerSecond: event.tokensPerSecond,
                  lastLlmPhase: event.phase,
                });
              } else if (event.type === "eta") {
                updateJob(jobId, {
                  estimatedFinishAt: event.estimatedFinishAt,
                });
              }
            }
          }

          if (!finalOutcome || finalOutcome.status !== "completed") {
            throw new Error("Audit stream ended without a result.");
          }

          updateJob(jobId, {
            status: "completed",
            finishedAt: Date.now(),
            codebaseInspected: finalOutcome.meta.codebaseInspected,
            interactions: finalOutcome.meta.interactions,
            currentStep: undefined,
          });
          return finalOutcome;
        } catch (error) {
          if (controller.signal.aborted) {
            updateJob(jobId, {
              status: "cancelled",
              finishedAt: Date.now(),
              currentStep: undefined,
            });
            return { status: "cancelled" };
          }
          const message =
            error instanceof Error ? error.message : "Something went wrong.";
          updateJob(jobId, {
            status: "failed",
            finishedAt: Date.now(),
            error: message,
            currentStep: undefined,
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

export function Countdown({
  to,
  className,
}: {
  to: number;
  className?: string;
}) {
  const [remainingMs, setRemainingMs] = React.useState(() => to - Date.now());

  React.useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, to - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [to]);

  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return (
    <span className={className}>
      {minutes}:{seconds}
    </span>
  );
}
