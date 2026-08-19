import {
  computeCacheKey,
  resolveCodebase,
  resolveLibrary,
  type AuditResult,
  type LibraryContext,
} from "./audit";
import {
  getDb,
  getProviderById,
  saveAuditReport,
  type StoredAuditReport,
} from "./db";
import {
  getLlmConfig,
  runLibraryAudit,
  type LlmConfigOverride,
  type LlmInteraction,
} from "./llm";
import { MissingInputError } from "./errors";
import { enrichLibrary } from "./signals";
import { getCachedAuditReport } from "./cache";
import { isProvider, type Provider } from "./providers";

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
  providerId?: string;
  provider?: Provider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
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

export function parseRequestBody(body: unknown): RunAuditInput {
  if (!body || typeof body !== "object") {
    throw new MissingInputError();
  }
  const {
    libraryUrl,
    version,
    prompt,
    providerId,
    provider,
    model,
    apiKey,
    baseUrl,
  } = body as {
    libraryUrl?: unknown;
    version?: unknown;
    prompt?: unknown;
    providerId?: unknown;
    provider?: unknown;
    model?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
  };
  if (typeof libraryUrl !== "string" || libraryUrl.trim().length === 0) {
    throw new MissingInputError();
  }

  const trimmedProvider: Provider | undefined =
    typeof provider === "string" ? (provider.trim() as Provider) : undefined;
  if (trimmedProvider && !isProvider(trimmedProvider)) {
    throw new MissingInputError(`Unsupported LLM provider: ${trimmedProvider}`);
  }

  const result: RunAuditInput = {
    libraryUrl: libraryUrl.trim(),
    version:
      typeof version === "string" && version.trim().length > 0
        ? version.trim()
        : undefined,
    prompt: typeof prompt === "string" ? prompt : undefined,
  };

  if (typeof providerId === "string" && providerId.trim()) {
    result.providerId = providerId.trim();
  }

  if (trimmedProvider) result.provider = trimmedProvider;
  if (typeof model === "string" && model.trim().length > 0) {
    result.model = model.trim();
  }
  if (typeof apiKey === "string" && apiKey.trim().length > 0) {
    result.apiKey = apiKey.trim();
  }
  if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
    result.baseUrl = baseUrl.trim();
  }

  return result;
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
  const {
    libraryUrl,
    version,
    prompt,
    providerId,
    provider,
    model,
    apiKey,
    baseUrl,
  } = input;
  const startedAt = Date.now();

  const dbInstance = db ?? (await getDb());

  let llmOverride: LlmConfigOverride | undefined;
  if (providerId) {
    const providerRow = await getProviderById(dbInstance, providerId);
    if (!providerRow) {
      throw new MissingInputError(`Provider not found: ${providerId}`);
    }
    const dbModels = JSON.parse(providerRow.models) as string[];
    llmOverride = {
      provider: providerRow.provider,
      apiKey: providerRow.api_key,
      model: model ?? dbModels[0] ?? undefined,
      baseUrl: providerRow.base_url ?? undefined,
    };
  } else if (provider || model || apiKey || baseUrl) {
    llmOverride = {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  }
  const llmConfig = getLlmConfig(llmOverride);

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

  const cacheKey = await computeCacheKey(
    fullContext,
    prompt,
    llmConfig.provider,
    llmConfig.model,
  );

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
    llmConfig,
  );

  await emitStep(onEvent, "validate", "started");
  const resultJson = JSON.stringify(result);
  const interactionJson = JSON.stringify(interactions);
  const llmModel = llmConfig.model;
  await emitStep(onEvent, "validate", "completed");

  await emitStep(onEvent, "persist", "started");
  const { auditId, reportId } = await saveAuditReport(dbInstance, {
    name: result.name,
    version: result.version,
    source: fullContext.source,
    url: fullContext.url,
    prompt,
    model: llmModel,
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
