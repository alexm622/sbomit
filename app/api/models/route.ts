import { isProvider } from "@/app/lib/providers";
import { fetchModelsForProvider } from "@/app/lib/llm-models";
import { getDb } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { parseJsonBody, withErrorHandling } from "@/app/lib/api";

interface ModelsRequest {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
}

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);

  const { provider, apiKey, baseUrl } = body as ModelsRequest;

  if (typeof provider !== "string" || !isProvider(provider)) {
    return Response.json(
      { error: "Unsupported or missing provider.", code: "MISSING_INPUT" },
      { status: 400 },
    );
  }

  if (provider !== "openai" && (typeof apiKey !== "string" || !apiKey)) {
    return Response.json(
      { error: "API key is required.", code: "MISSING_INPUT" },
      { status: 400 },
    );
  }

  if (
    provider === "openai" &&
    (typeof apiKey !== "string" || !apiKey) &&
    (typeof baseUrl !== "string" || !baseUrl)
  ) {
    return Response.json(
      {
        error: "API key or base URL is required for OpenAI.",
        code: "MISSING_INPUT",
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  await requireAdmin(db, request);
  const models = await fetchModelsForProvider(
    provider,
    typeof apiKey === "string" ? apiKey : undefined,
    typeof baseUrl === "string" ? baseUrl : undefined,
  );
  return Response.json({ models }, { status: 200 });
});
