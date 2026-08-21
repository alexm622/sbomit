import { z } from "zod";
import { getDb, listProviders, listProviderLimits, setProviderLimit } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { handleApiError, MissingInputError, AuditError } from "@/app/lib/errors";

const schema = z.object({
  providerId: z.string().min(1),
  dailyTokenLimit: z.number().int().nonnegative().nullable(),
});

export async function GET(request: Request): Promise<Response> {
  try {
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
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    await requireAdmin(db, request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new MissingInputError("Invalid JSON body.");
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new MissingInputError(first?.message ?? "Invalid limit data.");
    }

    const { providerId, dailyTokenLimit } = parsed.data;
    const provider = await db
      .prepare("SELECT id FROM providers WHERE id = ? LIMIT 1")
      .bind(providerId)
      .first<{ id: string }>();
    if (!provider) {
      throw new AuditError("NOT_FOUND", "Provider not found.", 404);
    }

    await setProviderLimit(db, providerId, dailyTokenLimit);
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
