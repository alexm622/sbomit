import { APIError } from "openai";
import {
  auditResultSchema,
  postProcessAuditResult,
  type AuditResult,
  type InvestigationArea,
  type LibraryContext,
} from "../audit";
import { AuditParseError, UpstreamRateLimitError } from "../errors";
import type { AuditEventHandler, AuditStep } from "../run-audit";
import { getLlmConfig, type LlmConfig, type LlmInteraction, type AuditWithInteractions } from "./config";
import {
  INVESTIGATION_PROMPT,
  DEEP_DIVE_PROMPT,
  METADATA_ONLY_PROMPT,
  investigationSchema,
  buildInvestigationContent,
  buildDeepDiveContent,
  buildMetadataOnlyContent,
} from "./prompts";
import { runStructured, parseRetryAfter } from "./structured";

async function runInvestigationPhase(
  context: LibraryContext,
  config: LlmConfig,
  userPrompt?: string,
): Promise<{ areas: InvestigationArea[]; interaction: LlmInteraction }> {
  const content = buildInvestigationContent(context, userPrompt);
  const { parsed, interaction } = await runStructured(
    config,
    INVESTIGATION_PROMPT,
    content,
    investigationSchema,
    "investigation_areas",
  );
  return { areas: parsed.investigationAreas, interaction };
}

async function runAuditPhase(
  context: LibraryContext,
  config: LlmConfig,
  areas: InvestigationArea[],
  userPrompt?: string,
): Promise<{ result: AuditResult; interaction: LlmInteraction }> {
  const content = buildDeepDiveContent(context, areas, userPrompt);
  const { parsed, interaction } = await runStructured(
    config,
    DEEP_DIVE_PROMPT,
    content,
    auditResultSchema,
    "audit_result",
  );
  return { result: parsed, interaction };
}

async function runMetadataOnlyAudit(
  context: LibraryContext,
  config: LlmConfig,
  userPrompt?: string,
): Promise<{ result: AuditResult; interaction: LlmInteraction }> {
  const content = buildMetadataOnlyContent(context, userPrompt);
  const { parsed, interaction } = await runStructured(
    config,
    METADATA_ONLY_PROMPT,
    content,
    auditResultSchema,
    "audit_result",
  );
  return { result: parsed, interaction };
}

export async function runLibraryAudit(
  context: LibraryContext,
  userPrompt?: string,
  onEvent?: AuditEventHandler,
  config?: LlmConfig,
): Promise<AuditWithInteractions> {
  const resolvedConfig = config ?? getLlmConfig();

  async function emitLlmEvent(interaction: LlmInteraction): Promise<void> {
    if (!onEvent) return;
    const started = new Date(interaction.startedAt).getTime();
    const finished = new Date(interaction.finishedAt).getTime();
    const tokens =
      (interaction.tokensInput ?? 0) + (interaction.tokensOutput ?? 0);
    const elapsedMs = Math.max(1, finished - started);
    await onEvent({
      type: "llm",
      phase: interaction.systemPrompt.includes("investigation")
        ? "investigate"
        : interaction.systemPrompt.includes("deep code review")
          ? "deep-dive"
          : "audit",
      tokensPerSecond: Math.round(tokens / (elapsedMs / 1000)),
      tokensInput: interaction.tokensInput,
      tokensOutput: interaction.tokensOutput,
      elapsedMs,
    });
  }

  async function emitStep(
    step: AuditStep,
    status: "started" | "completed",
  ): Promise<void> {
    if (!onEvent) return;
    await onEvent({ type: "step", step, status });
  }

  try {
    let result: AuditResult;
    const interactions: LlmInteraction[] = [];

    if (context.codebase && context.codebase.files.length > 0) {
      await emitStep("investigate", "started");
      const { areas, interaction: investigationInteraction } =
        await runInvestigationPhase(context, resolvedConfig, userPrompt);
      interactions.push(investigationInteraction);
      await emitLlmEvent(investigationInteraction);
      await emitStep("investigate", "completed");

      await emitStep("deep-dive", "started");
      const { result: auditResult, interaction: auditInteraction } =
        await runAuditPhase(context, resolvedConfig, areas, userPrompt);
      result = auditResult;
      interactions.push(auditInteraction);
      await emitLlmEvent(auditInteraction);
      await emitStep("deep-dive", "completed");
    } else {
      await emitStep("metadata-only", "started");
      const { result: auditResult, interaction } = await runMetadataOnlyAudit(
        context,
        resolvedConfig,
        userPrompt,
      );
      result = auditResult;
      interactions.push(interaction);
      await emitLlmEvent(interaction);
      await emitStep("metadata-only", "completed");
    }

    result = postProcessAuditResult(result, context);
    return { result, interactions };
  } catch (error) {
    if (error instanceof APIError) {
      if (error.status === 429) {
        throw new UpstreamRateLimitError(
          "OpenAI-compatible API",
          parseRetryAfter(error.headers || new Headers()),
        );
      }
      let message = `OpenAI-compatible request failed: ${error.message || "unknown error"}`;
      const baseUrl = resolvedConfig.baseUrl ?? "";
      if (baseUrl.includes("anthropic.com")) {
        message +=
          ". Anthropic's API is not OpenAI-compatible. Use the Anthropic provider type, or use an OpenAI-compatible proxy such as OpenRouter.";
      } else if (baseUrl.includes("googleapis.com")) {
        message +=
          ". Google's Gemini API is not OpenAI-compatible. Use the Google provider type.";
      } else if (error.status === 401) {
        message +=
          " Check that the API key is correct for the configured base URL.";
      }
      throw new AuditParseError(message);
    }
    if (
      error instanceof UpstreamRateLimitError ||
      error instanceof AuditParseError
    ) {
      throw error;
    }
    throw new AuditParseError(
      error instanceof Error ? error.message : "Audit failed unexpectedly.",
    );
  }
}
