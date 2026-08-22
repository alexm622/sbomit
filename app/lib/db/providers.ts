import type { Provider } from "../providers";
import { generatePublicId } from "./client";

export interface StoredProvider {
  id: string;
  name: string;
  provider: Provider;
  api_key: string;
  base_url: string | null;
  models: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderInput {
  name: string;
  provider: Provider;
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  isDefault?: boolean;
}

export interface ProviderModelPair {
  providerId?: string;
  model: string;
}

function generateProviderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return generatePublicId();
}

export async function listProviders(db: D1Database): Promise<StoredProvider[]> {
  const result = await db
    .prepare("SELECT * FROM providers ORDER BY created_at ASC")
    .all<StoredProvider>();
  return result.results || [];
}

export async function getProviderById(
  db: D1Database,
  id: string,
): Promise<StoredProvider | null> {
  return db
    .prepare("SELECT * FROM providers WHERE id = ? LIMIT 1")
    .bind(id)
    .first<StoredProvider>();
}

async function clearDefaultFlag(db: D1Database): Promise<void> {
  await db.prepare("UPDATE providers SET is_default = 0").run();
}

export async function createProvider(
  db: D1Database,
  input: ProviderInput,
): Promise<string> {
  const id = generateProviderId();
  if (input.isDefault) {
    await clearDefaultFlag(db);
  }
  await db
    .prepare(
      `INSERT INTO providers (id, name, provider, api_key, base_url, models, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.provider,
      input.apiKey ?? "",
      input.baseUrl ?? null,
      JSON.stringify(input.models),
      input.isDefault ? 1 : 0,
    )
    .run();
  return id;
}

export async function updateProvider(
  db: D1Database,
  id: string,
  input: Partial<ProviderInput>,
): Promise<boolean> {
  const existing = await getProviderById(db, id);
  if (!existing) {
    return false;
  }

  if (input.isDefault) {
    await clearDefaultFlag(db);
  }

  const name = input.name ?? existing.name;
  const provider = input.provider ?? existing.provider;
  const apiKey =
    input.apiKey !== undefined && input.apiKey !== ""
      ? input.apiKey
      : existing.api_key;
  const baseUrl =
    input.baseUrl !== undefined ? input.baseUrl : existing.base_url;
  const models =
    input.models !== undefined ? JSON.stringify(input.models) : existing.models;
  const isDefault =
    input.isDefault !== undefined ? (input.isDefault ? 1 : 0) : existing.is_default;

  await db
    .prepare(
      `UPDATE providers
       SET name = ?, provider = ?, api_key = ?, base_url = ?, models = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(name, provider, apiKey, baseUrl ?? null, models, isDefault, id)
    .run();
  return true;
}

export async function deleteProvider(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM providers WHERE id = ?")
    .bind(id)
    .run();
  return result.meta?.changes === 1;
}

export interface StoredProviderLimit {
  provider_id: string;
  daily_token_limit: number | null;
  updated_at: string;
}

export async function getProviderLimit(
  db: D1Database,
  providerId: string,
): Promise<StoredProviderLimit | null> {
  return db
    .prepare("SELECT * FROM provider_limits WHERE provider_id = ? LIMIT 1")
    .bind(providerId)
    .first<StoredProviderLimit>();
}

export async function setProviderLimit(
  db: D1Database,
  providerId: string,
  dailyTokenLimit: number | null,
): Promise<void> {
  if (dailyTokenLimit === null) {
    await db
      .prepare("DELETE FROM provider_limits WHERE provider_id = ?")
      .bind(providerId)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO provider_limits (provider_id, daily_token_limit)
       VALUES (?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET
         daily_token_limit = excluded.daily_token_limit,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(providerId, dailyTokenLimit)
    .run();
}

export async function listProviderLimits(
  db: D1Database,
): Promise<StoredProviderLimit[]> {
  const result = await db
    .prepare(
      `SELECT pl.* FROM provider_limits pl
       JOIN providers p ON p.id = pl.provider_id
       ORDER BY p.name`,
    )
    .all<StoredProviderLimit>();
  return result.results || [];
}

export async function recordProviderUsage(
  db: D1Database,
  providerId: string,
  tokens: number,
  date = new Date().toISOString().slice(0, 10),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO provider_usage (provider_id, usage_date, tokens_total)
       VALUES (?, ?, ?)
       ON CONFLICT(provider_id, usage_date) DO UPDATE SET
         tokens_total = tokens_total + excluded.tokens_total`,
    )
    .bind(providerId, date, tokens)
    .run();
}

export async function getProviderUsage(
  db: D1Database,
  providerId: string,
  date = new Date().toISOString().slice(0, 10),
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT tokens_total FROM provider_usage WHERE provider_id = ? AND usage_date = ? LIMIT 1",
    )
    .bind(providerId, date)
    .first<{ tokens_total: number }>();
  return row?.tokens_total ?? 0;
}
