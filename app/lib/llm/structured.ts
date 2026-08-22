import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { AuditParseError, UpstreamRateLimitError } from "../errors";
import type { LlmConfig, LlmInteraction } from "./config";
import { inferProvider } from "./config";

export function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = parseInt(value, 10);
  return Number.isNaN(seconds) ? undefined : seconds;
}

export function joinApiPath(
  baseUrl: string | undefined,
  path: string,
): string | undefined {
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function cleanJsonSchema(schema: object): object {
  const cleaned = { ...schema } as Record<string, unknown>;
  delete cleaned["$schema"];
  return cleaned;
}

export function toGeminiSchema(node: unknown): unknown {
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
    provider: inferProvider(config),
    providerId: config.providerId,
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
    providerId: config.providerId,
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
    providerId: config.providerId,
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

export async function runStructured<T>(
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
