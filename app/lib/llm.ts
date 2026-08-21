import OpenAI, { APIError } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  auditResultSchema,
  buildAuditPrompt,
  postProcessAuditResult,
  type AuditResult,
  type InvestigationArea,
  type LibraryContext,
} from "./audit";
import { AuditParseError, UpstreamRateLimitError } from "./errors";
import { z } from "zod";
import {
  buildBudgetedSnapshot,
  buildLiteSnapshot,
  estimateTokens,
  formatSnapshotForLlm,
  sourceTokenBudget,
  type CodebaseSnapshot,
} from "./codebase";
import type { AuditEventHandler, AuditStep } from "./run-audit";
import { type Provider, isProvider } from "./providers";

export type { Provider };

function coerceStringToArray<T>(
  value: unknown,
  parser: (item: unknown) => T | undefined,
): T[] | undefined {
  if (Array.isArray(value)) {
    return value.map(parser).filter((item): item is T => item !== undefined);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map(parser)
          .filter((item): item is T => item !== undefined);
      }
    } catch {
      // Fall through to default.
    }
  }
  return undefined;
}

const investigationAreaItemSchema = z.object({
  area: z.string().default(""),
  rationale: z.string().default(""),
  files: z.array(z.string()).default([]),
});

export const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
];

export interface CompetitionModelConfig {
  provider: Provider;
  model: string;
}

export const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "o1-mini", "o3-mini"],
  anthropic: [
    "claude-3-5-sonnet-20241022",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
  ],
  google: ["gemini-1.5-flash-latest", "gemini-1.5-pro-latest"],
};

const investigationSchema = z.object({
  investigationAreas: z.preprocess(
    (value) =>
      coerceStringToArray(value, (item) => {
        const result = investigationAreaItemSchema.safeParse(item);
        return result.success ? result.data : undefined;
      }) ?? [],
    z.array(investigationAreaItemSchema),
  ),
});

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LlmConfigOverride {
  provider?: Provider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface LlmInteraction {
  provider: Provider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  request: unknown;
  response?: unknown;
  startedAt: string;
  finishedAt: string;
  tokensInput?: number;
  tokensOutput?: number;
  error?: string;
}

export interface AuditWithInteractions {
  result: AuditResult;
  interactions: LlmInteraction[];
}

const INVESTIGATION_PROMPT = `You are a software supply-chain auditor reviewing a library's source code.

Your first task is to identify the most important areas to investigate for security, supply-chain, and dependency risks. You are shown either the full codebase snapshot or a "lite" snapshot containing manifest/lifecycle files, a sample of small source files, and a complete file listing. Look at the metadata and the provided snapshot. Focus on:
- install / postinstall / lifecycle scripts
- network calls, dynamic requires, eval, child_process
- obfuscated or minified code bundled in source
- dependency pinning and lockfile hygiene
- sensitive file access, environment variable reads
- unexpected top-level side effects

Return 3-10 investigation areas as a JSON array assigned to the key "investigationAreas". Each area must be an object with exactly these keys:
- area: short name (string)
- rationale: why it matters (string)
- files: specific file paths from the snapshot to examine in detail (array of strings)

Example shape:
{
  "investigationAreas": [
    {
      "area": "Lifecycle scripts",
      "rationale": "postinstall scripts can run arbitrary code during install",
      "files": ["package.json", "scripts/install.js"]
    }
  ]
}

If you are looking at a lite snapshot, prefer selecting files that were not already shown in full so the deep-dive pass can read fresh source code.`;

const DEEP_DIVE_PROMPT = `You are a software supply-chain auditor performing a deep code review.

You previously identified key investigation areas. Now examine the FULL CONTENTS of the files listed for those areas and produce a complete, structured audit report.

Be specific: cite file paths and line snippets as evidence. If a concern turns out to be benign after inspection, note that and lower the severity. If you find concrete issues, explain the exploit path or maintenance risk.

Return ALL fields defined in the response schema. If a list has no items, return it as an empty array []. If the summary would be empty, write a brief one-sentence summary instead. Do not omit any field.

For the score field, use this rubric as a guide: start from 100, subtract roughly 20-25 for each critical issue, 10-15 for each high issue, 5-8 for each medium issue, and 2-3 for each low issue; subtract 10 for an incompatible license, and prefer the 70-95 range for well-maintained packages with only minor concerns. The final score shown to the user will be computed from your findings, so be consistent and proportional.`;

const METADATA_ONLY_PROMPT = `You are a software supply-chain auditor reviewing library metadata. The full source code was not available, so base your assessment on the metadata alone.

Identify areas that would be worth investigating if the source code were available, and produce a structured audit report. Be explicit that findings are inferred from metadata, not confirmed by code inspection.

Return ALL fields defined in the response schema. If a list has no items, return it as an empty array []. If the summary would be empty, write a brief one-sentence summary instead. Do not omit any field.

For the score field, use this rubric as a guide: start from 100, subtract roughly 20-25 for each critical issue, 10-15 for each high issue, 5-8 for each medium issue, and 2-3 for each low issue; subtract 10 for an incompatible license. Since source code was not inspected, reserve the top scores (90-100) for packages with no metadata red flags; the final score shown to the user will be computed from your findings.`;

export function getLlmConfig(override?: LlmConfigOverride): LlmConfig {
  const rawProvider = (
    override?.provider ??
    process.env.LLM_PROVIDER ??
    "openai"
  ).toLowerCase();
  if (!isProvider(rawProvider)) {
    throw new AuditParseError(
      `Unsupported LLM provider: ${rawProvider}. Use openai, anthropic, or google.`,
    );
  }
  const provider = rawProvider;
  const baseUrl = override?.baseUrl ?? process.env.LLM_BASE_URL;

  switch (provider) {
    case "openai": {
      const apiKey =
        override?.apiKey ||
        process.env.LLM_API_KEY ||
        process.env.OPENAI_API_KEY;
      if (!apiKey && !baseUrl) {
        throw new AuditParseError(
          "LLM API key is not configured. Set LLM_API_KEY or OPENAI_API_KEY.",
        );
      }
      // Keyless OpenAI-compatible endpoints (e.g. local llama.cpp/vLLM)
      // ignore the key, but the SDK requires a non-empty string.
      return {
        provider,
        apiKey: apiKey ?? "unused",
        model: override?.model || process.env.LLM_MODEL || "gpt-4o-mini",
        baseUrl,
      };
    }
    case "anthropic": {
      const apiKey =
        override?.apiKey ||
        process.env.LLM_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_API_KEY;
      if (!apiKey) {
        throw new AuditParseError(
          "LLM API key is not configured. Set LLM_API_KEY or ANTHROPIC_API_KEY.",
        );
      }
      return {
        provider,
        apiKey,
        model:
          override?.model ||
          process.env.LLM_MODEL ||
          "claude-3-5-sonnet-20241022",
        baseUrl,
      };
    }
    case "google": {
      const apiKey =
        override?.apiKey ||
        process.env.LLM_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new AuditParseError(
          "LLM API key is not configured. Set LLM_API_KEY or GEMINI_API_KEY.",
        );
      }
      return {
        provider,
        apiKey,
        model:
          override?.model ||
          process.env.LLM_MODEL ||
          "gemini-1.5-flash-latest",
        baseUrl,
      };
    }
    default:
      throw new AuditParseError(
        `Unsupported LLM provider: ${provider}. Use openai, anthropic, or google.`,
      );
  }
}

function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = parseInt(value, 10);
  return Number.isNaN(seconds) ? undefined : seconds;
}

function joinApiPath(
  baseUrl: string | undefined,
  path: string,
): string | undefined {
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function cleanJsonSchema(schema: object): object {
  const cleaned = { ...schema } as Record<string, unknown>;
  delete cleaned["$schema"];
  return cleaned;
}

function toGeminiSchema(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const obj = { ...node } as Record<string, unknown>;
  delete obj["$schema"];
  delete obj["additionalProperties"];

  if (typeof obj.type === "string") {
    const upper = obj.type.toUpperCase();
    if (
      ["STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "OBJECT"].includes(
        upper,
      )
    ) {
      obj.type = upper;
    }
  }

  if (obj.properties && typeof obj.properties === "object") {
    const properties = obj.properties as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      properties[key] = toGeminiSchema(properties[key]);
    }
  }

  if (obj.items) {
    obj.items = toGeminiSchema(obj.items);
  }

  return obj;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

interface AnthropicMessageResponse {
  content: AnthropicToolUseBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

async function runOpenAiStructured<T>(
  config: LlmConfig,
  systemPrompt: string,
  content: string,
  schema: z.ZodSchema<T>,
  schemaName: string,
): Promise<{ parsed: T; interaction: LlmInteraction }> {
  const startedAt = new Date().toISOString();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content },
  ];
  const requestPayload = {
    model: config.model,
    messages,
    response_format: zodResponseFormat(schema, schemaName),
  };

  const completion = await client.chat.completions.parse(requestPayload);
  const finishedAt = new Date().toISOString();

  const parsed = completion.choices[0]?.message?.parsed as T | undefined;
  if (!parsed) {
    throw new AuditParseError(
      "The LLM did not return a structured result.",
    );
  }

  const interaction: LlmInteraction = {
    provider: "openai",
    model: config.model,
    systemPrompt,
    userPrompt: content,
    request: requestPayload,
    response: completion,
    startedAt,
    finishedAt,
    tokensInput: completion.usage?.prompt_tokens,
    tokensOutput: completion.usage?.completion_tokens,
  };

  return { parsed, interaction };
}

async function runAnthropicStructured<T>(
  config: LlmConfig,
  systemPrompt: string,
  content: string,
  schema: z.ZodSchema<T>,
  toolName: string,
): Promise<{ parsed: T; interaction: LlmInteraction }> {
  const startedAt = new Date().toISOString();
  const endpoint =
    joinApiPath(config.baseUrl, "/messages") ??
    "https://api.anthropic.com/v1/messages";
  const inputSchema = cleanJsonSchema(schema.toJSONSchema());

  const requestPayload = {
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user" as const, content }],
    tools: [
      {
        name: toolName,
        description:
          "Return a structured result. Populate every field in the schema. Use empty arrays for lists with no items and write a brief one-sentence summary if there is nothing to report.",
        input_schema: inputSchema,
      },
    ],
    tool_choice: { type: "tool" as const, name: toolName },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestPayload),
  });
  const finishedAt = new Date().toISOString();

  if (!response.ok) {
    if (response.status === 429) {
      throw new UpstreamRateLimitError(
        "Anthropic API",
        parseRetryAfter(response.headers),
      );
    }
    throw new AuditParseError(
      `Anthropic request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const toolUse = data.content.find(
    (block): block is AnthropicToolUseBlock =>
      block.type === "tool_use" && block.name === toolName,
  );
  if (!toolUse) {
    throw new AuditParseError(
      "Anthropic did not return a structured result.",
    );
  }

  const interaction: LlmInteraction = {
    provider: "anthropic",
    model: config.model,
    systemPrompt,
    userPrompt: content,
    request: requestPayload,
    response: data,
    startedAt,
    finishedAt,
    tokensInput: data.usage?.input_tokens,
    tokensOutput: data.usage?.output_tokens,
  };

  return { parsed: schema.parse(toolUse.input), interaction };
}

async function runGoogleStructured<T>(
  config: LlmConfig,
  systemPrompt: string,
  content: string,
  schema: z.ZodSchema<T>,
): Promise<{ parsed: T; interaction: LlmInteraction }> {
  const startedAt = new Date().toISOString();
  const responseSchema = toGeminiSchema(schema.toJSONSchema());

  const requestPayload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user" as const,
        parts: [{ text: content }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  const endpoint =
    joinApiPath(
      config.baseUrl,
      `/models/${config.model}:generateContent?key=${config.apiKey}`,
    ) ??
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
  const finishedAt = new Date().toISOString();

  if (!response.ok) {
    if (response.status === 429) {
      throw new UpstreamRateLimitError(
        "Gemini API",
        parseRetryAfter(response.headers),
      );
    }
    throw new AuditParseError(
      `Gemini request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new AuditParseError(
      "Gemini did not return a structured result.",
    );
  }

  const interaction: LlmInteraction = {
    provider: "google",
    model: config.model,
    systemPrompt,
    userPrompt: content,
    request: requestPayload,
    response: data,
    startedAt,
    finishedAt,
    tokensInput: data.usageMetadata?.promptTokenCount,
    tokensOutput: data.usageMetadata?.candidatesTokenCount,
  };

  return { parsed: schema.parse(JSON.parse(text)), interaction };
}

async function runStructured<T>(
  config: LlmConfig,
  systemPrompt: string,
  content: string,
  schema: z.ZodSchema<T>,
  schemaName: string,
): Promise<{ parsed: T; interaction: LlmInteraction }> {
  switch (config.provider) {
    case "openai":
      return runOpenAiStructured(config, systemPrompt, content, schema, schemaName);
    case "anthropic":
      return runAnthropicStructured(
        config,
        systemPrompt,
        content,
        schema,
        schemaName,
      );
    case "google":
      return runGoogleStructured(config, systemPrompt, content, schema);
    default:
      throw new AuditParseError(
        `Unsupported LLM provider: ${config.provider}.`,
      );
  }
}

function buildMetadataSection(
  context: LibraryContext,
  userPrompt?: string,
): string {
  return buildAuditPrompt(context, userPrompt);
}

function selectSnapshotForInvestigation(
  context: LibraryContext,
): CodebaseSnapshot {
  if (!context.codebase) {
    return { files: [], fileCount: 0, totalSize: 0 };
  }

  const fullText = formatSnapshotForLlm(context.codebase);
  const budget = sourceTokenBudget();

  if (estimateTokens(fullText) <= budget) {
    return context.codebase;
  }

  const lite = buildLiteSnapshot(context.codebase);
  const liteText = formatSnapshotForLlm(lite);
  if (estimateTokens(liteText) <= budget) {
    return lite;
  }

  // Even the lite snapshot is too large; trim it to fit.
  return buildBudgetedSnapshot(lite, budget);
}

function buildInvestigationContent(
  context: LibraryContext,
  userPrompt?: string,
): string {
  const metadata = buildMetadataSection(context, userPrompt);
  const snapshot = selectSnapshotForInvestigation(context);
  const codebase = formatSnapshotForLlm(snapshot);
  return `${metadata}\n\n${INVESTIGATION_PROMPT}\n\n${codebase}`;
}

function selectFilesForDeepDive(
  context: LibraryContext,
  areas: InvestigationArea[],
): CodebaseSnapshot {
  if (!context.codebase) {
    return { files: [], fileCount: 0, totalSize: 0 };
  }

  const relevantFiles = new Set<string>();
  for (const area of areas) {
    for (const file of area.files) {
      relevantFiles.add(file);
    }
  }

  const budget = sourceTokenBudget();
  // Reserve a portion of the budget for the full snapshot if it fits, so the
  // LLM can still see the whole picture while focusing on selected files.
  const fullText = formatSnapshotForLlm(context.codebase);
  if (estimateTokens(fullText) <= budget) {
    return context.codebase;
  }

  return buildBudgetedSnapshot(context.codebase, budget, relevantFiles);
}

function buildDeepDiveContent(
  context: LibraryContext,
  areas: InvestigationArea[],
  userPrompt?: string,
): string {
  const metadata = buildMetadataSection(context, userPrompt);

  const areasText = JSON.stringify(
    {
      investigationAreas: areas,
    },
    null,
    2,
  );

  const snapshot = selectFilesForDeepDive(context, areas);
  const filesText =
    snapshot.files.length > 0
      ? `Files selected for deep review:\n\n${formatSnapshotForLlm(snapshot)}`
      : "No source files were available for deep review.";

  return `${metadata}\n\n${DEEP_DIVE_PROMPT}\n\nInvestigation areas:\n${areasText}\n\n${filesText}`;
}

function buildMetadataOnlyContent(
  context: LibraryContext,
  userPrompt?: string,
): string {
  const metadata = buildMetadataSection(context, userPrompt);
  return `${metadata}\n\n${METADATA_ONLY_PROMPT}`;
}

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

const mergeFindingAttributionSchema = z.object({
  type: z.enum(["risk", "investigationArea", "deepDiveFinding"]),
  index: z.number().int().min(0),
  sources: z.array(z.enum(["A", "B", "judge"])),
});

const mergeExclusionSchema = z.object({
  type: z.enum(["risk", "investigationArea", "deepDiveFinding"]),
  fromModel: z.enum(["A", "B"]),
  titleOrFile: z.string(),
  reason: z.string(),
});

const competitionMergeResultSchema = z.object({
  merged: auditResultSchema,
  attributions: z.array(mergeFindingAttributionSchema).default([]),
  exclusions: z.array(mergeExclusionSchema).default([]),
});

const MERGE_AUDITS_PROMPT = `You are a senior software supply-chain auditor reviewing two independent AI audits of the same library.

Your task is to merge them into a single, coherent audit report and document exactly how you merged them. Follow these rules:

- Remove duplicate findings: if both audits report the same risk, deep-dive finding, or investigation area, keep only one representative entry (prefer the one with stronger evidence or higher severity).
- Preserve unique findings from both audits.
- Add your own findings only if both audits missed something important and you can cite specific evidence from the audit data provided.
- Reconcile conflicting assessments: if the audits disagree on severity or interpretation, use your judgment and explain briefly in the summary.
- Produce one unified summary that reflects the combined assessment.
- Compute a single trust score (0-100) that represents the merged conclusion. Be proportional: start from 100 and subtract for each confirmed issue using the same rubric as the original audits.
- Keep the same structured output format. Use the library metadata (name, version, etc.) from Audit A unless Audit B clearly has more accurate data.

ATTRIBUTION: For every item in the merged report, record which model(s) originated it in the "attributions" array. Use source "A" for Audit A, "B" for Audit B, and "judge" only for findings you add that neither audit contained. The index must correspond to the position of the item in the merged report array (0-based).

EXCLUSIONS: For every finding you remove as a duplicate, low-quality, or unsupported, record it in the "exclusions" array. Include the type of item, which model it came from (A or B), a short identifying title or file, and a brief reason for exclusion.

Both audits reviewed the same library and version, so the merged report must have the same name and version.`;

function buildMergeContent(
  resultA: AuditResult,
  resultB: AuditResult,
  userPrompt?: string,
): string {
  const metadata = `Library: ${resultA.name}@${resultA.version}`;
  const promptSection = userPrompt
    ? `User focus: ${userPrompt}\n\n`
    : "";
  return `${metadata}\n\n${promptSection}Audit A:\n${JSON.stringify(resultA, null, 2)}\n\nAudit B:\n${JSON.stringify(resultB, null, 2)}\n\n${MERGE_AUDITS_PROMPT}`;
}

function applyAttributions(
  merged: AuditResult,
  attributions: z.infer<typeof mergeFindingAttributionSchema>[],
): AuditResult {
  for (const attr of attributions) {
    if (attr.type === "risk" && merged.risks[attr.index]) {
      merged.risks[attr.index].sources = attr.sources;
    } else if (attr.type === "investigationArea" && merged.investigationAreas[attr.index]) {
      merged.investigationAreas[attr.index].sources = attr.sources;
    } else if (attr.type === "deepDiveFinding" && merged.deepDiveFindings[attr.index]) {
      merged.deepDiveFindings[attr.index].sources = attr.sources;
    }
  }
  return merged;
}

export interface CompetitionMergeOutput {
  result: AuditResult;
  exclusions: z.infer<typeof mergeExclusionSchema>[];
  interaction: LlmInteraction;
}

export async function mergeAuditResults(
  resultA: AuditResult,
  resultB: AuditResult,
  mergeConfig: LlmConfig,
  userPrompt?: string,
): Promise<CompetitionMergeOutput> {
  const content = buildMergeContent(resultA, resultB, userPrompt);
  const { parsed, interaction } = await runStructured(
    mergeConfig,
    MERGE_AUDITS_PROMPT,
    content,
    competitionMergeResultSchema,
    "merged_audit_result",
  );
  const merged = applyAttributions(parsed.merged, parsed.attributions);
  return { result: merged, exclusions: parsed.exclusions, interaction };
}
