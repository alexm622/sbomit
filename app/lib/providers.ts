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

export function parseModelsInput(value: string): string[] {
  return value
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}
