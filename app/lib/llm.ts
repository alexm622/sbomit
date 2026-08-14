import OpenAI, { APIError } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  auditResultSchema,
  buildAuditPrompt,
  postProcessAuditResult,
  type AuditResult,
  type LibraryContext,
} from "./audit";
import { AuditParseError, UpstreamRateLimitError } from "./errors";

type Provider = "openai" | "anthropic" | "google";

interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

const SYSTEM_PROMPT =
  "You are a software supply-chain auditor. Analyze library metadata and produce a structured audit report. Be factual and conservative. If data is missing, infer reasonably or mark uncertainty with lower severity.";

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

async function runOpenAiAudit(
  config: LlmConfig,
  content: string,
): Promise<AuditResult> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  const completion = await client.chat.completions.parse({
    model: config.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    response_format: zodResponseFormat(auditResultSchema, "audit_result"),
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new AuditParseError(
      "The LLM did not return a structured audit result.",
    );
  }
  return parsed;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

interface AnthropicMessageResponse {
  content: AnthropicToolUseBlock[];
}

async function runAnthropicAudit(
  config: LlmConfig,
  content: string,
): Promise<AuditResult> {
  const endpoint = config.baseUrl || "https://api.anthropic.com/v1/messages";
  const inputSchema = cleanJsonSchema(auditResultSchema.toJSONSchema());

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      tools: [
        {
          name: "audit_result",
          description:
            "Return a structured software supply-chain audit report.",
          input_schema: inputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "audit_result" },
    }),
  });

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
      block.type === "tool_use" && block.name === "audit_result",
  );
  if (!toolUse) {
    throw new AuditParseError(
      "Anthropic did not return a structured audit result.",
    );
  }

  return auditResultSchema.parse(toolUse.input);
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

async function runGoogleAudit(
  config: LlmConfig,
  content: string,
): Promise<AuditResult> {
  const endpoint =
    config.baseUrl ||
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  const responseSchema = toGeminiSchema(auditResultSchema.toJSONSchema());

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: content }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

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
      "Gemini did not return a structured audit result.",
    );
  }

  return auditResultSchema.parse(JSON.parse(text));
}

export async function runLibraryAudit(
  context: LibraryContext,
  userPrompt?: string,
): Promise<AuditResult> {
  const content = buildAuditPrompt(context, userPrompt);
  const config = getLlmConfig();

  try {
    let parsed: AuditResult;
    switch (config.provider) {
      case "openai":
        parsed = await runOpenAiAudit(config, content);
        break;
      case "anthropic":
        parsed = await runAnthropicAudit(config, content);
        break;
      case "google":
        parsed = await runGoogleAudit(config, content);
        break;
      default:
        throw new AuditParseError(
          `Unsupported LLM provider: ${config.provider}.`,
        );
    }
    return postProcessAuditResult(parsed, context);
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
    if (error instanceof UpstreamRateLimitError || error instanceof AuditParseError) {
      throw error;
    }
    throw new AuditParseError(
      error instanceof Error ? error.message : "Audit failed unexpectedly.",
    );
  }
}
