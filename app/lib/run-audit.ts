import {
  computeCacheKey,
  resolveCodebase,
  resolveLibrary,
  type AuditResult,
  type LibraryContext,
} from "./audit";
import { getDb, saveAuditReport, type StoredAuditReport } from "./db";
import { getLlmConfig, runLibraryAudit, type LlmInteraction } from "./llm";
import { MissingInputError } from "./errors";
import { enrichLibrary } from "./signals";
import { getCachedAuditReport } from "./cache";

export type AuditStep =
  | "resolve"
  | "download"
  | "investigate"
  | "deep-dive"
  | "metadata-only"
  | "validate"
  | "persist";

export type AuditEvent =
  | {
      type: "step";
      step: AuditStep;
      status: "started" | "completed";
      detail?: string;
    }
  | {
      type: "llm";
      phase: string;
      tokensPerSecond: number;
      tokensInput?: number;
      tokensOutput?: number;
      elapsedMs: number;
    }
  | {
      type: "eta";
      estimatedFinishAt: number;
    };

export type AuditEventHandler = (event: AuditEvent) => void | Promise<void>;

export interface RunAuditInput {
  libraryUrl: string;
  version?: string;
  prompt?: string;
}

export interface RunAuditResult {
  result: AuditResult;
  meta: {
    cached: boolean;
    auditId: number;
    reportId: number;
    codebaseInspected: boolean;
    interactions: LlmInteraction[];
  };
}

export function parseRequestBody(
  body: unknown,
): { libraryUrl: string; version?: string; prompt?: string } {
  if (!body || typeof body !== "object") {
    throw new MissingInputError();
  }
  const { libraryUrl, version, prompt } = body as {
    libraryUrl?: unknown;
    version?: unknown;
    prompt?: unknown;
  };
  if (typeof libraryUrl !== "string" || libraryUrl.trim().length === 0) {
    throw new MissingInputError();
  }
  return {
    libraryUrl: libraryUrl.trim(),
    version:
      typeof version === "string" && version.trim().length > 0
        ? version.trim()
        : undefined,
    prompt: typeof prompt === "string" ? prompt : undefined,
  };
}

function storedReportToResult(report: StoredAuditReport): AuditResult {
  const parsed = JSON.parse(report.result_json) as Partial<AuditResult>;
  return {
    name: parsed.name ?? "",
    version: parsed.version ?? "",
    score: parsed.score ?? 0,
    summary: parsed.summary ?? "",
    risks: parsed.risks ?? [],
    investigationAreas: parsed.investigationAreas ?? [],
    deepDiveFindings: parsed.deepDiveFindings ?? [],
    dependencies: parsed.dependencies ?? [],
    license: parsed.license ?? { type: "", compatible: true, note: "" },
    maintainers: parsed.maintainers ?? [],
    lastPublished: parsed.lastPublished ?? "",
    weeklyDownloads: parsed.weeklyDownloads ?? "",
    cves: parsed.cves ?? [],
  };
}

function storedReportToInteractions(
  report: StoredAuditReport,
): LlmInteraction[] | undefined {
  if (!report.interaction_json) return undefined;
  const parsed = JSON.parse(report.interaction_json) as
    | LlmInteraction
    | LlmInteraction[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

const STEP_ORDER: AuditStep[] = [
  "resolve",
  "download",
  "investigate",
  "deep-dive",
  "validate",
  "persist",
];

function estimateFinishAt(
  startedAt: number,
  completedStep: AuditStep,
): number {
  const elapsedMs = Date.now() - startedAt;
  const completedIndex = STEP_ORDER.indexOf(completedStep);
  if (completedIndex <= 0) {
    return Date.now() + Math.max(5000, elapsedMs * 2);
  }
  const avgMsPerStep = elapsedMs / (completedIndex + 1);
  const remainingSteps = STEP_ORDER.length - (completedIndex + 1);
  return Date.now() + avgMsPerStep * Math.max(1, remainingSteps);
}

async function emitStep(
  onEvent: AuditEventHandler | undefined,
  step: AuditStep,
  status: "started" | "completed",
  detail?: string,
): Promise<void> {
  if (!onEvent) return;
  await onEvent({ type: "step", step, status, detail });
}

async function emitEta(
  onEvent: AuditEventHandler | undefined,
  startedAt: number,
  completedStep: AuditStep,
): Promise<void> {
  if (!onEvent) return;
  await onEvent({
    type: "eta",
    estimatedFinishAt: estimateFinishAt(startedAt, completedStep),
  });
}

export async function runAudit(
  input: RunAuditInput,
  onEvent?: AuditEventHandler,
  db?: D1Database,
): Promise<RunAuditResult> {
  const { libraryUrl, version, prompt } = input;
  const startedAt = Date.now();

  await emitStep(onEvent, "resolve", "started");
  const context = await resolveLibrary(libraryUrl, version);
  await emitStep(onEvent, "resolve", "completed", context.name);

  await emitStep(onEvent, "download", "started");
  const codebase = await resolveCodebase(context);
  const codebaseInspected = !!codebase && codebase.files.length > 0;
  const baseContext: LibraryContext = {
    ...context,
    ...(codebase ? { codebase } : {}),
  };

  // Enrichment runs in parallel with codebase download and is failure-tolerant.
  const signals = await enrichLibrary(baseContext);
  const fullContext: LibraryContext = {
    ...baseContext,
    signals,
  };

  const advisoryCount = signals.advisories.length;
  await emitStep(
    onEvent,
    "download",
    "completed",
    codebase
      ? `${codebase.fileCount} files, ${codebase.totalSize} bytes${advisoryCount > 0 ? `, ${advisoryCount} advisories` : ""}`
      : advisoryCount > 0
        ? `metadata only, ${advisoryCount} advisories`
        : "metadata only",
  );

  const dbInstance = db ?? (await getDb());
  const cacheKey = await computeCacheKey(fullContext, prompt);

  const cached = await getCachedAuditReport(
    dbInstance,
    cacheKey,
    fullContext.version,
  );

  if (cached) {
    const result = storedReportToResult(cached);
    const interactions = storedReportToInteractions(cached) ?? [];
    return {
      result,
      meta: {
        cached: true,
        auditId: cached.audit_id,
        reportId: cached.id,
        codebaseInspected: cached.codebase_inspected === 1,
        interactions,
      },
    };
  }

  const { result, interactions } = await runLibraryAudit(
    fullContext,
    prompt,
    async (event) => {
      await onEvent?.(event);
      if (event.type === "step" && event.status === "completed") {
        await emitEta(onEvent, startedAt, event.step);
      }
    },
  );

  await emitStep(onEvent, "validate", "started");
  const resultJson = JSON.stringify(result);
  const interactionJson = JSON.stringify(interactions);
  const { model } = getLlmConfig();
  await emitStep(onEvent, "validate", "completed");

  await emitStep(onEvent, "persist", "started");
  const { auditId, reportId } = await saveAuditReport(dbInstance, {
    name: result.name,
    version: result.version,
    source: fullContext.source,
    url: fullContext.url,
    prompt,
    model,
    score: result.score,
    resultJson,
    cacheKey,
    interactionJson,
    codebaseInspected,
  });
  await emitStep(onEvent, "persist", "completed");

  return {
    result,
    meta: {
      cached: false,
      auditId,
      reportId,
      codebaseInspected,
      interactions,
    },
  };
}
