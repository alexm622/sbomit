import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { GET as listProviders, POST as createProvider } from "./route";
import {
  GET as getProvider,
  PUT as updateProvider,
  DELETE as deleteProvider,
} from "./[id]/route";
import * as dbModule from "@/app/lib/db";

vi.mock("@/app/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof dbModule>();
  return {
    ...actual,
    getDb: vi.fn(() => Promise.resolve(env.DB)),
  };
});

async function setupProvidersTable(db: D1Database) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS providers (` +
      `id TEXT PRIMARY KEY,` +
      `name TEXT NOT NULL,` +
      `provider TEXT NOT NULL,` +
      `api_key TEXT NOT NULL,` +
      `base_url TEXT,` +
      `models TEXT NOT NULL,` +
      `is_default INTEGER NOT NULL DEFAULT 0,` +
      `created_at DATETIME DEFAULT CURRENT_TIMESTAMP,` +
      `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP` +
      `);`,
  );
}

describe("/api/providers", () => {
  const db = env.DB;

  beforeAll(async () => {
    await setupProvidersTable(db);
  });

  afterEach(async () => {
    await reset();
    await setupProvidersTable(db);
  });

  it("creates, updates (including api key), and deletes a provider", async () => {
    const createReq = new Request("http://localhost/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test OpenAI",
        provider: "openai",
        apiKey: "",
        models: ["gpt-4o-mini"],
        isDefault: true,
      }),
    });

    const createRes = await createProvider(createReq);
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const updateReq = new Request(`http://localhost/api/providers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test OpenAI Updated",
        apiKey: "sk-secret-key",
      }),
    });

    const updateRes = await updateProvider(updateReq, {
      params: Promise.resolve({ id }),
    });
    expect(updateRes.status).toBe(200);

    const stored = await dbModule.getProviderById(env.DB, id);
    expect(stored).not.toBeNull();
    expect(stored?.api_key).toBe("sk-secret-key");
    expect(stored?.name).toBe("Test OpenAI Updated");

    const listRes = await listProviders();
    const listData = (await listRes.json()) as {
      providers: Array<{ id: string; apiKey?: string }>;
    };
    expect(listData.providers).toHaveLength(1);
    expect(listData.providers[0].apiKey).toBeUndefined();

    const getRes = await getProvider(
      new Request(`http://localhost/api/providers/${id}`),
      { params: Promise.resolve({ id }) },
    );
    const getData = (await getRes.json()) as {
      provider: { id: string; apiKey?: string };
    };
    expect(getData.provider.apiKey).toBeUndefined();

    const deleteRes = await deleteProvider(
      new Request(`http://localhost/api/providers/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(deleteRes.status).toBe(200);
  });
});
