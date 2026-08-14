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

export interface StoredReport {
  id: number;
  audit_id: number;
  public_id: string;
  prompt: string | null;
  model: string;
  score: number;
  result_json: string;
  created_at: string;
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

export async function saveReport(
  db: D1Database,
  auditId: number,
  report: {
    publicId: string;
    prompt?: string;
    model: string;
    score: number;
    resultJson: string;
  },
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO audit_reports (audit_id, public_id, prompt, model, score, result_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      auditId,
      report.publicId,
      report.prompt ?? null,
      report.model,
      report.score,
      report.resultJson,
    )
    .run();
  return report.publicId;
}

export async function getReportByPublicId(
  db: D1Database,
  publicId: string,
): Promise<StoredReport | null> {
  return db
    .prepare("SELECT * FROM audit_reports WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<StoredReport>();
}

export async function getRecentReportByUrl(
  db: D1Database,
  url: string,
  ttlHours: number,
): Promise<StoredReport | null> {
  const result = await db
    .prepare(
      `SELECT r.* FROM audit_reports r
       JOIN package_audits a ON r.audit_id = a.id
       WHERE a.url = ? AND r.created_at > datetime('now', ?)
       ORDER BY r.created_at DESC
       LIMIT 1`,
    )
    .bind(url, `-${ttlHours} hours`)
    .first<StoredReport>();
  return result || null;
}
