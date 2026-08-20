import {
  deleteProvider,
  getDb,
  getProviderById,
  updateProvider,
} from "@/app/lib/db";
import { isProvider } from "@/app/lib/providers";
import { AuditError, handleApiError, MissingInputError } from "@/app/lib/errors";

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const db = await getDb();
    const provider = await getProviderById(db, id);
    if (!provider) {
      return handleApiError(
        new AuditError("NOT_FOUND", "Provider not found.", 404),
      );
    }
    return Response.json({ provider: publicProvider(provider) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
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

    const patch: {
      name?: string;
      provider?: import("@/app/lib/providers").Provider;
      apiKey?: string;
      baseUrl?: string;
      models?: string[];
      isDefault?: boolean;
    } = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        throw new MissingInputError("Provider name cannot be empty.");
      }
      patch.name = name.trim();
    }

    if (provider !== undefined) {
      if (typeof provider !== "string" || !isProvider(provider)) {
        throw new MissingInputError("Unsupported provider.");
      }
      patch.provider = provider;
    }

    if (apiKey !== undefined) {
      if (typeof apiKey === "string" && apiKey.trim()) {
        patch.apiKey = apiKey.trim();
      }
      // Empty string means "keep existing key".
    }

    if (baseUrl !== undefined) {
      patch.baseUrl =
        typeof baseUrl === "string" ? baseUrl.trim() || undefined : undefined;
    }

    if (models !== undefined) {
      const parsedModels = parseModels(models);
      if (!parsedModels || parsedModels.length === 0) {
        throw new MissingInputError("At least one model is required.");
      }
      patch.models = parsedModels;
    }

    if (isDefault !== undefined) {
      patch.isDefault = isDefault === true;
    }

    const db = await getDb();
    const updated = await updateProvider(db, id, patch);
    if (!updated) {
      return Response.json(
        { error: "Provider not found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const db = await getDb();
    const deleted = await deleteProvider(db, id);
    if (!deleted) {
      return Response.json(
        { error: "Provider not found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
