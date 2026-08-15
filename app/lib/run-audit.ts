import {
  computeCacheKey,
  parseGitHubUrl,
  resolveCodebase,
  resolveLibrary,
  type AuditResult,
  type LibraryContext,
} from "./audit";
import {
  fetchGitHubVulnerabilities,
  fetchNpmVulnerabilities,
  type Cve,
} from "./cve";
import { getDb, saveAuditReport, type StoredAuditReport } from "./db";
import { getLlmConfig, runLibraryAudit, type LlmInteraction } from "./llm";
import { MissingInputError } from "./errors";

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
  return JSON.parse(report.result_json) as AuditResult;
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

async function fetchCves(context: LibraryContext): Promise<Cve[]> {
  try {
    if (context.source === "npm") {
      return await fetchNpmVulnerabilities(context.name, context.version);
    }
    const gh = parseGitHubUrl(context.url);
    if (gh) {
      return await fetchGitHubVulnerabilities(
        gh.owner,
        gh.repo,
        context.version,
      );
    }
    return [];
  } catch (error) {
    // CVE fetching is best-effort; do not fail the audit if OSV is down.
    console.error(
      "Failed to fetch CVEs:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

export async function runAudit(
  input: RunAuditInput,
  onEvent?: AuditEventHandler,
): Promise<RunAuditResult> {
  const { libraryUrl, version, prompt } = input;
  const startedAt = Date.now();

  await emitStep(onEvent, "resolve", "started");
  const context = await resolveLibrary(libraryUrl, version);
  await emitStep(onEvent, "resolve", "completed", context.name);

  await emitStep(onEvent, "download", "started");
  const codebase = await resolveCodebase(context);
  const codebaseInspected = !!codebase && codebase.files.length > 0;
  const cves = await fetchCves(context);
  const fullContext: LibraryContext = {
    ...context,
    cves,
    ...(codebase ? { codebase } : {}),
  };
  await emitStep(
    onEvent,
    "download",
    "completed",
    codebase
      ? `${codebase.fileCount} files, ${codebase.totalSize} bytes${cves.length > 0 ? `, ${cves.length} CVEs` : ""}`
      : cves.length > 0
        ? `metadata only, ${cves.length} CVEs`
        : "metadata only",
  );

  const db = await getDb();
  const cacheKey = await computeCacheKey(fullContext, prompt);

  const cached = await db
    .prepare("SELECT * FROM audit_reports WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first<StoredAuditReport>();

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
  const { auditId, reportId } = await saveAuditReport(db, {
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
