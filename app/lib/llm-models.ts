import {
  AuditError,
  AuditParseError,
  UpstreamRateLimitError,
} from "./errors";
import type { Provider } from "./providers";

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

async function fetchOpenAiModels(
  apiKey: string | undefined,
  baseUrl: string | undefined,
): Promise<string[]> {
  const endpoint = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/models`
    : "https://api.openai.com/v1/models";

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    if (response.status === 429) {
      throw new UpstreamRateLimitError(
        "OpenAI-compatible API",
        parseRetryAfter(response.headers),
      );
    }
    let message = `Failed to fetch models: ${response.status} ${response.statusText}`;
    if (endpoint.includes("anthropic.com")) {
      message +=
        ". Anthropic's API is not OpenAI-compatible. Create an Anthropic provider instead of an OpenAI provider.";
    } else if (endpoint.includes("googleapis.com")) {
      message +=
        ". Google's Gemini API is not OpenAI-compatible. Create a Google provider instead of an OpenAI provider.";
    }
    throw new AuditError("UPSTREAM_ERROR", message, 502);
  }

  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  return (data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id));
}

async function fetchAnthropicModels(
  apiKey: string,
  baseUrl: string | undefined,
): Promise<string[]> {
  const endpoint =
    joinApiPath(baseUrl, "/models?limit=1000") ??
    "https://api.anthropic.com/v1/models?limit=1000";
  const response = await fetch(endpoint, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new UpstreamRateLimitError(
        "Anthropic API",
        parseRetryAfter(response.headers),
      );
    }
    throw new AuditError(
      "UPSTREAM_ERROR",
      `Failed to fetch models: ${response.status} ${response.statusText}`,
      502,
    );
  }

  const data = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  return (data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id));
}

async function fetchGoogleModels(
  apiKey: string,
  baseUrl: string | undefined,
): Promise<string[]> {
  const base = joinApiPath(baseUrl, "/models");
  const endpoint = base
    ? `${base}?key=${apiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    if (response.status === 429) {
      throw new UpstreamRateLimitError(
        "Google Gemini API",
        parseRetryAfter(response.headers),
      );
    }
    throw new AuditError(
      "UPSTREAM_ERROR",
      `Failed to fetch models: ${response.status} ${response.statusText}`,
      502,
    );
  }

  const data = (await response.json()) as {
    models?: Array<{ name?: string }>;
  };
  return (data.models ?? [])
    .map((model) => model.name?.replace(/^models\//, ""))
    .filter((id): id is string => Boolean(id));
}

export async function fetchModelsForProvider(
  provider: Provider,
  apiKey: string | undefined,
  baseUrl: string | undefined,
): Promise<string[]> {
  switch (provider) {
    case "openai":
      return fetchOpenAiModels(apiKey, baseUrl);
    case "anthropic":
      if (!apiKey) {
        throw new AuditParseError("Anthropic API key is required.");
      }
      return fetchAnthropicModels(apiKey, baseUrl);
    case "google":
      if (!apiKey) {
        throw new AuditParseError("Google API key is required.");
      }
      return fetchGoogleModels(apiKey, baseUrl);
    default:
      throw new AuditParseError(`Unsupported provider: ${provider}.`);
  }
}
