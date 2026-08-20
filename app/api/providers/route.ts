import { getDb, listProviders, createProvider } from "@/app/lib/db";
import { isProvider } from "@/app/lib/providers";
import { handleApiError, MissingInputError } from "@/app/lib/errors";

function parseModels(value: unknown): string[] | undefined {
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

function publicProvider(provider: {
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

export async function GET(): Promise<Response> {
  try {
    const db = await getDb();
    const providers = await listProviders(db);
    return Response.json({ providers: providers.map(publicProvider) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const { name, provider, apiKey, baseUrl, models, isDefault } = body as {
      name?: unknown;
      provider?: unknown;
      apiKey?: unknown;
      baseUrl?: unknown;
      models?: unknown;
      isDefault?: unknown;
    };

    if (typeof name !== "string" || !name.trim()) {
      throw new MissingInputError("Provider name is required.");
    }
    if (typeof provider !== "string" || !isProvider(provider)) {
      throw new MissingInputError("Unsupported or missing provider.");
    }
    if (typeof apiKey !== "string") {
      throw new MissingInputError("API key is required.");
    }

    const parsedModels = parseModels(models);
    if (!parsedModels || parsedModels.length === 0) {
      throw new MissingInputError("At least one model is required.");
    }

    const db = await getDb();
    const id = await createProvider(db, {
      name: name.trim(),
      provider,
      apiKey: apiKey.trim(),
      baseUrl: typeof baseUrl === "string" ? baseUrl.trim() || undefined : undefined,
      models: parsedModels,
      isDefault: isDefault === true,
    });

    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
