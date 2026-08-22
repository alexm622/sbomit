import { z } from "zod";
import { getDb, listProviders, listProviderLimits, setProviderLimit } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { AuditError } from "@/app/lib/errors";
import { parseJsonBody, parseWithSchema, withErrorHandling } from "@/app/lib/api";

const schema = z.object({
  providerId: z.string().min(1),
  dailyTokenLimit: z.number().int().nonnegative().nullable(),
});

export const GET = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);

  const providers = await listProviders(db);
  const limits = await listProviderLimits(db);
  const limitsById = new Map(limits.map((l) => [l.provider_id, l]));

  const result = providers.map((p) => ({
    id: p.id,
    name: p.name,
    provider: p.provider,
    dailyTokenLimit: limitsById.get(p.id)?.daily_token_limit ?? null,
  }));

  return Response.json({ providers: result });
});

export const PUT = withErrorHandling(async (request: Request): Promise<Response> => {
  const db = await getDb();
  await requireAdmin(db, request);

  const body = await parseJsonBody(request);
  const { providerId, dailyTokenLimit } = parseWithSchema(schema, body);

  const provider = await db
    .prepare("SELECT id FROM providers WHERE id = ? LIMIT 1")
    .bind(providerId)
    .first<{ id: string }>();
  if (!provider) {
    throw new AuditError("NOT_FOUND", "Provider not found.", 404);
  }

  await setProviderLimit(db, providerId, dailyTokenLimit);
  return Response.json({ ok: true });
});
