export interface StoredDependency {
  name: string;
  version: string;
  dependency_type: string;
}

export interface StoredAudit {
  id: number;
  name: string;
  version: string;
  source: string;
  url: string;
  audited_at: string;
}

export async function getDb(): Promise<D1Database> {
  const db = (process.env as Record<string, D1Database | undefined>).DB;
  if (!db) {
    throw new Error(
      "D1 database binding (DB) is not available. Run with Cloudflare runtime or wrangler dev.",
    );
  }
  return db;
}

export async function saveDependencyTree(
  db: D1Database,
  audit: {
    name: string;
    version: string;
    source: string;
    url: string;
  },
  dependencies: StoredDependency[],
): Promise<number> {
  const insertAudit = db
    .prepare(
      `INSERT INTO package_audits (name, version, source, url) VALUES (?, ?, ?, ?)`,
    )
    .bind(audit.name, audit.version, audit.source, audit.url);

  const auditResult = await insertAudit.run<{ id: number }>();
  const auditId = auditResult.meta?.last_row_id as number | undefined;
  if (!auditId) {
    throw new Error("Failed to insert package audit.");
  }

  if (dependencies.length > 0) {
    const insertDep = db.prepare(
      `INSERT INTO package_dependencies (audit_id, name, version, dependency_type) VALUES (?, ?, ?, ?)`,
    );
    await db.batch(
      dependencies.map((dep) =>
        insertDep.bind(auditId, dep.name, dep.version, dep.dependency_type),
      ),
    );
  }

  return auditId;
}

export async function getAuditByUrl(
  db: D1Database,
  url: string,
): Promise<StoredAudit | null> {
  return db
    .prepare("SELECT * FROM package_audits WHERE url = ? LIMIT 1")
    .bind(url)
    .first<StoredAudit>();
}

export async function getDependenciesByAuditId(
  db: D1Database,
  auditId: number,
): Promise<StoredDependency[]> {
  const result = await db
    .prepare(
      "SELECT name, version, dependency_type FROM package_dependencies WHERE audit_id = ?",
    )
    .bind(auditId)
    .all<StoredDependency>();
  return result.results || [];
}
