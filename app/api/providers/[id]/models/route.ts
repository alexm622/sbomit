import { getDb, getProviderById } from "@/app/lib/db";
import { fetchModelsForProvider } from "@/app/lib/llm-models";
import { AuditError, handleApiError } from "@/app/lib/errors";
import { requireAdmin } from "@/app/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const db = await getDb();
    await requireAdmin(db, request);
    const provider = await getProviderById(db, id);
    if (!provider) {
      return handleApiError(
        new AuditError("NOT_FOUND", "Provider not found.", 404),
      );
    }

    const models = await fetchModelsForProvider(
      provider.provider,
      provider.api_key || undefined,
      provider.base_url || undefined,
    );
    return Response.json({ models }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
