import OpenAI, { APIError } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  auditResultSchema,
  buildAuditPrompt,
  buildCodebasePrompt,
  postProcessAuditResult,
  type AuditResult,
  type InvestigationArea,
  type LibraryContext,
} from "./audit";
import { AuditParseError, UpstreamRateLimitError } from "./errors";
import { z } from "zod";

export type Provider = "openai" | "anthropic" | "google";

const investigationSchema = z.object({
  investigationAreas: z.array(
    z.object({
      area: z.string(),
      rationale: z.string(),
      files: z.array(z.string()),
    }),
  ),
});

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
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

Your first task is to identify the most important areas to investigate for security, supply-chain, and dependency risks. Look at the metadata and the provided codebase snapshot (file names and contents). Focus on:
- install / postinstall / lifecycle scripts
- network calls, dynamic requires, eval, child_process
- obfuscated or minified code bundled in source
- dependency pinning and lockfile hygiene
- sensitive file access, environment variable reads
- unexpected top-level side effects

Return 3-10 investigation areas. For each area include:
- area: short name
- rationale: why it matters
- files: specific file paths from the snapshot to examine in detail`;

const DEEP_DIVE_PROMPT = `You are a software supply-chain auditor performing a deep code review.

You previously identified key investigation areas. Now examine the FULL CONTENTS of the files listed for those areas and produce a complete, structured audit report.

Be specific: cite file paths and line snippets as evidence. If a concern turns out to be benign after inspection, note that and lower the severity. If you find concrete issues, explain the exploit path or maintenance risk.`;

const METADATA_ONLY_PROMPT = `You are a software supply-chain auditor reviewing library metadata. The full source code was not available, so base your assessment on the metadata alone.

Identify areas that would be worth investigating if the source code were available, and produce a structured audit report. Be explicit that findings are inferred from metadata, not confirmed by code inspection.`;

export function getLlmConfig(): LlmConfig {
  const provider = (
    process.env.LLM_PROVIDER || "openai"
  ).toLowerCase() as Provider;
  const baseUrl = process.env.LLM_BASE_URL;

  switch (provider) {
    case "openai": {
      const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
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
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        baseUrl,
      };
    }
    case "anthropic": {
      const apiKey =
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
        model: process.env.LLM_MODEL || "claude-3-5-sonnet-20241022",
        baseUrl,
      };
    }
    case "google": {
      const apiKey =
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
        model: process.env.LLM_MODEL || "gemini-1.5-flash-latest",
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
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
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
  const endpoint = config.baseUrl || "https://api.anthropic.com/v1/messages";
  const inputSchema = cleanJsonSchema(schema.toJSONSchema());

  const requestPayload = {
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user" as const, content }],
    tools: [
      {
        name: toolName,
        description: "Return a structured result.",
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
    config.baseUrl ||
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

function buildInvestigationContent(
  context: LibraryContext,
  userPrompt?: string,
): string {
  const metadata = buildMetadataSection(context, userPrompt);
  const codebase = buildCodebasePrompt(context);
  return `${metadata}\n\n${INVESTIGATION_PROMPT}\n\n${codebase}`;
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

  // Pull full contents for files mentioned in the investigation areas.
  const relevantFiles = new Set<string>();
  for (const area of areas) {
    for (const file of area.files) {
      relevantFiles.add(file);
    }
  }

  const fileContents: string[] = [];
  if (context.codebase) {
    for (const file of context.codebase.files) {
      if (relevantFiles.has(file.path)) {
        fileContents.push(
          `--- FILE: ${file.path} ---\n${file.content}`,
        );
      }
    }
  }

  const filesText =
    fileContents.length > 0
      ? `Files selected for deep review:\n\n${fileContents.join("\n\n")}`
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
): Promise<AuditWithInteractions> {
  const config = getLlmConfig();

  try {
    let result: AuditResult;
    const interactions: LlmInteraction[] = [];

    if (context.codebase && context.codebase.files.length > 0) {
      const { areas, interaction: investigationInteraction } =
        await runInvestigationPhase(context, config, userPrompt);
      interactions.push(investigationInteraction);

      const { result: auditResult, interaction: auditInteraction } =
        await runAuditPhase(context, config, areas, userPrompt);
      result = auditResult;
      interactions.push(auditInteraction);
    } else {
      const { result: auditResult, interaction } = await runMetadataOnlyAudit(
        context,
        config,
        userPrompt,
      );
      result = auditResult;
      interactions.push(interaction);
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
      throw new AuditParseError(
        `OpenAI-compatible request failed: ${error.message || "unknown error"}`,
      );
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
