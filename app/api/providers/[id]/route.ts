import {
  deleteProvider,
  getDb,
  getProviderById,
  updateProvider,
} from "@/app/lib/db";
import { isProvider, parseModels, publicProvider } from "@/app/lib/providers";
import { AuditError, MissingInputError } from "@/app/lib/errors";
import { requireAuth, requireAdmin } from "@/app/lib/auth";
import { parseJsonBody, withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const { id } = await params;
  const db = await getDb();
  await requireAuth(db, request);
  const provider = await getProviderById(db, id);
  if (!provider) {
    throw new AuditError("NOT_FOUND", "Provider not found.", 404);
  }
  return Response.json({ provider: publicProvider(provider) });
});

export const PUT = withErrorHandling(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const { id } = await params;
  const body = await parseJsonBody(request);

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
  await requireAdmin(db, request);
  const updated = await updateProvider(db, id, patch);
  if (!updated) {
    return Response.json(
      { error: "Provider not found.", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
});

export const DELETE = withErrorHandling(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const { id } = await params;
  const db = await getDb();
  await requireAdmin(db, request);
  const deleted = await deleteProvider(db, id);
  if (!deleted) {
    return Response.json(
      { error: "Provider not found.", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return Response.json({ ok: true });
});
