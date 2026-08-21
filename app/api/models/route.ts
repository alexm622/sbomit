import { isProvider } from "@/app/lib/providers";
import { fetchModelsForProvider } from "@/app/lib/llm-models";
import { handleApiError } from "@/app/lib/errors";
import { getDb } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";

interface ModelsRequest {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body.", code: "MISSING_INPUT" },
      { status: 400 },
    );
  }

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

  try {
    const db = await getDb();
    await requireAdmin(db, request);
    const models = await fetchModelsForProvider(
      provider,
      typeof apiKey === "string" ? apiKey : undefined,
      typeof baseUrl === "string" ? baseUrl : undefined,
    );
    return Response.json({ models }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
