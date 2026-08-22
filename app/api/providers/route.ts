import { getDb, listProviders, createProvider } from "@/app/lib/db";
import { isProvider, parseModels, publicProvider } from "@/app/lib/providers";
import { MissingInputError } from "@/app/lib/errors";
import { requireAuth, requireAdmin } from "@/app/lib/auth";
import { parseJsonBody, withErrorHandling } from "@/app/lib/api";

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAuth(db, request);
  const providers = await listProviders(db);
  return Response.json({ providers: providers.map(publicProvider) });
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);

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
  await requireAdmin(db, request);
  const id = await createProvider(db, {
    name: name.trim(),
    provider,
    apiKey: apiKey.trim(),
    baseUrl: typeof baseUrl === "string" ? baseUrl.trim() || undefined : undefined,
    models: parsedModels,
    isDefault: isDefault === true,
  });

  return Response.json({ id }, { status: 201 });
});
