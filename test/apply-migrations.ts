import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

const migrations = (env as unknown as Record<string, unknown>)
  .TEST_MIGRATIONS as Array<{ name: string; queries: string[] }>;

await applyD1Migrations(env.DB, migrations);
