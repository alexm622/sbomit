import { isProvider } from "@/app/lib/providers";
import { fetchModelsForProvider } from "@/app/lib/llm-models";
import { getDb } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { MissingInputError } from "@/app/lib/errors";
import { parseJsonBody, withErrorHandling } from "@/app/lib/api";

interface ModelsRequest {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
}

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);

  const body = await parseJsonBody(request);
  const { provider, apiKey, baseUrl } = body as ModelsRequest;

  if (typeof provider !== "string" || !isProvider(provider)) {
    throw new MissingInputError("Unsupported or missing provider.");
  }

  if (provider !== "openai" && (typeof apiKey !== "string" || !apiKey)) {
    throw new MissingInputError("API key is required.");
  }

  if (
    provider === "openai" &&
    (typeof apiKey !== "string" || !apiKey) &&
    (typeof baseUrl !== "string" || !baseUrl)
  ) {
    throw new MissingInputError("API key or base URL is required for OpenAI.");
  }

  const models = await fetchModelsForProvider(
    provider,
    typeof apiKey === "string" ? apiKey : undefined,
    typeof baseUrl === "string" ? baseUrl : undefined,
  );
  return Response.json({ models }, { status: 200 });
});
