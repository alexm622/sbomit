import { AuditParseError } from "../errors";
import { type Provider, isProvider } from "../providers";

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  providerId?: string;
}

export interface LlmConfigOverride {
  provider?: Provider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  providerId?: string;
}

export interface LlmInteraction {
  provider: string;
  providerId?: string;
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
  result: import("../audit").AuditResult;
  interactions: LlmInteraction[];
}

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

// Return a more specific provider name for OpenAI-compatible endpoints.
// This prevents Moonshot, DeepSeek, etc. from being lumped under "openai"
// in usage analytics.
export function inferProvider(config: LlmConfig): string {
  const baseUrl = config.baseUrl?.toLowerCase() ?? "";
  const model = config.model.toLowerCase();

  if (
    baseUrl.includes("moonshot") ||
    model.includes("moonshot") ||
    model.includes("kimi")
  ) {
    return "moonshot";
  }
  if (baseUrl.includes("deepseek") || model.includes("deepseek")) {
    return "deepseek";
  }
  if (baseUrl.includes("openrouter") || baseUrl.includes("openrouter.ai")) {
    return "openrouter";
  }
  if (baseUrl.includes("together") || baseUrl.includes("together.xyz")) {
    return "together";
  }
  if (baseUrl.includes("fireworks") || baseUrl.includes("fireworks.ai")) {
    return "fireworks";
  }
  if (baseUrl.includes("groq") || baseUrl.includes("groq.com")) {
    return "groq";
  }
  if (baseUrl.includes("perplexity") || baseUrl.includes("perplexity.ai")) {
    return "perplexity";
  }
  if (baseUrl.includes("openai") || baseUrl.includes("openai.com")) {
    return "openai";
  }
  if (baseUrl.includes("anthropic") || baseUrl.includes("anthropic.com")) {
    return "anthropic";
  }
  if (
    baseUrl.includes("google") ||
    baseUrl.includes("googleapis") ||
    baseUrl.includes("generativelanguage")
  ) {
    return "google";
  }

  return config.provider;
}
