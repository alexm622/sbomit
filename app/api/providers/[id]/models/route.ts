import { getDb, getProviderById } from "@/app/lib/db";
import { fetchModelsForProvider } from "@/app/lib/llm-models";
import { AuditError } from "@/app/lib/errors";
import { requireAdmin } from "@/app/lib/auth";
import { withErrorHandling } from "@/app/lib/api";

export const POST = withErrorHandling(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const { id } = await params;
  const db = await getDb();
  await requireAdmin(db, request);
  const provider = await getProviderById(db, id);
  if (!provider) {
    throw new AuditError("NOT_FOUND", "Provider not found.", 404);
  }

  const models = await fetchModelsForProvider(
    provider.provider,
    provider.api_key || undefined,
    provider.base_url || undefined,
  );
  return Response.json({ models }, { status: 200 });
});
