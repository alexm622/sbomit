import { DbUnavailableError } from "../errors";

export function generatePublicId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let i = 0; i < 12; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

export async function getDb(env?: Record<string, unknown>): Promise<D1Database> {
  if (env) {
    const db = env.DB as D1Database | undefined;
    if (db) {
      return db;
    }
    throw new DbUnavailableError();
  }

  const processDb = (process.env as Record<string, D1Database | undefined>).DB;
  if (processDb) {
    return processDb;
  }

  // Resolve the binding from the Cloudflare context. Works when deployed to
  // Workers (OpenNext), in `opennextjs-cloudflare preview`, and in `next dev`
  // via the OpenNext dev proxy.
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const db = (ctx.env as unknown as Record<string, unknown>).DB as
      | D1Database
      | undefined;
    if (db) {
      return db;
    }
  } catch {
    // Not running in a Cloudflare context.
  }

  throw new DbUnavailableError();
}
