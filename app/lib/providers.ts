export type Provider = "openai" | "anthropic" | "google";

export const PROVIDERS: Provider[] = ["openai", "anthropic", "google"];

export const providerLabels: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

export const defaultModels: Record<Provider, string[]> = {
  openai: [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
    "o3-mini",
  ],
  anthropic: [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
  ],
  google: [
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest",
    "gemini-2.0-flash-exp",
  ],
};

export function isProvider(value: string): value is Provider {
  return PROVIDERS.includes(value as Provider);
}

export interface ProviderConfig {
  id: string;
  name: string;
  provider: Provider;
  apiKey?: string;
  hasApiKey?: boolean;
  baseUrl?: string;
  models: string[];
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function createDefaultProviderConfig(
  provider: Provider = "openai",
  index = 1,
): ProviderConfig {
  return {
    id: `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${providerLabels[provider]} ${index}`,
    provider,
    apiKey: "",
    models: [...defaultModels[provider]],
  };
}

export function parseModels(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map((m) => (typeof m === "string" ? m.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
  }
  return undefined;
}

export function parseModelsInput(value: string): string[] {
  return parseModels(value) ?? [];
}

export function publicProvider(provider: {
  id: string;
  name: string;
  provider: string;
  api_key: string;
  base_url: string | null;
  models: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: provider.id,
    name: provider.name,
    provider: provider.provider,
    baseUrl: provider.base_url,
    models: JSON.parse(provider.models) as string[],
    hasApiKey: Boolean(provider.api_key),
    isDefault: provider.is_default === 1,
    createdAt: provider.created_at,
    updatedAt: provider.updated_at,
  };
}
