import { DbUnavailableError } from "./errors";

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

export interface StoredAuditReport {
  id: number;
  audit_id: number;
  prompt: string | null;
  model: string;
  score: number;
  result_json: string;
  cache_key: string | null;
  interaction_json: string | null;
  codebase_inspected: number;
  created_at: string;
}

export interface StoredAuditReportSummary {
  id: number;
  audit_id: number;
  prompt: string | null;
  model: string;
  score: number;
  created_at: string;
  name: string;
  version: string;
  source: string;
  url: string;
  provider: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  started_at: string | null;
  finished_at: string | null;
  codebase_inspected: number;
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

export async function saveAuditReport(
  db: D1Database,
  input: {
    name: string;
    version: string;
    source: string;
    url: string;
    prompt?: string;
    model: string;
    score: number;
    resultJson: string;
    cacheKey?: string;
    interactionJson?: string;
    codebaseInspected?: boolean;
  },
): Promise<{ auditId: number; reportId: number }> {
  const insertAudit = db
    .prepare(
      `INSERT INTO package_audits (name, version, source, url) VALUES (?, ?, ?, ?)`,
    )
    .bind(input.name, input.version, input.source, input.url);

  const auditResult = await insertAudit.run<{ id: number }>();
  const auditId = auditResult.meta?.last_row_id as number | undefined;
  if (!auditId) {
    throw new Error("Failed to insert package audit.");
  }

  const insertReport = db
    .prepare(
      `INSERT INTO audit_reports (audit_id, prompt, model, score, result_json, cache_key, interaction_json, codebase_inspected) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      auditId,
      input.prompt ?? null,
      input.model,
      input.score,
      input.resultJson,
      input.cacheKey ?? null,
      input.interactionJson ?? null,
      input.codebaseInspected ? 1 : 0,
    );

  const reportResult = await insertReport.run<{ id: number }>();
  const reportId = reportResult.meta?.last_row_id as number | undefined;
  if (!reportId) {
    throw new Error("Failed to insert audit report.");
  }

  return { auditId, reportId };
}

export async function getAuditById(
  db: D1Database,
  id: number,
): Promise<StoredAudit | null> {
  return db
    .prepare("SELECT * FROM package_audits WHERE id = ? LIMIT 1")
    .bind(id)
    .first<StoredAudit>();
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

export async function getAuditReportById(
  db: D1Database,
  id: number,
): Promise<StoredAuditReport | null> {
  return db
    .prepare("SELECT * FROM audit_reports WHERE id = ? LIMIT 1")
    .bind(id)
    .first<StoredAuditReport>();
}

export async function getAuditReportByAuditId(
  db: D1Database,
  auditId: number,
): Promise<StoredAuditReport | null> {
  return db
    .prepare("SELECT * FROM audit_reports WHERE audit_id = ? LIMIT 1")
    .bind(auditId)
    .first<StoredAuditReport>();
}

export async function getAuditReportByCacheKey(
  db: D1Database,
  cacheKey: string,
): Promise<StoredAuditReport | null> {
  return db
    .prepare("SELECT * FROM audit_reports WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first<StoredAuditReport>();
}

export async function listAuditReports(
  db: D1Database,
  limit = 100,
): Promise<StoredAuditReportSummary[]> {
  const result = await db
    .prepare(
      `SELECT r.id, r.audit_id, r.prompt, r.model, r.score, r.created_at,
              a.name, a.version, a.source, a.url,
              JSON_EXTRACT(r.interaction_json, '$.provider') AS provider,
              JSON_EXTRACT(r.interaction_json, '$.tokensInput') AS tokens_input,
              JSON_EXTRACT(r.interaction_json, '$.tokensOutput') AS tokens_output,
              JSON_EXTRACT(r.interaction_json, '$.startedAt') AS started_at,
              JSON_EXTRACT(r.interaction_json, '$.finishedAt') AS finished_at,
              r.codebase_inspected
       FROM audit_reports r
       JOIN package_audits a ON a.id = r.audit_id
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<StoredAuditReportSummary>();
  return result.results || [];
}

export async function deleteAuditReport(
  db: D1Database,
  reportId: number,
): Promise<boolean> {
  const report = await getAuditReportById(db, reportId);
  if (!report) {
    return false;
  }

  // Remove the report, then the parent audit row when no other reports
  // reference it (its dependency rows cascade via FK / are removed first).
  await db.batch([
    db.prepare("DELETE FROM audit_reports WHERE id = ?").bind(reportId),
    db
      .prepare(
        `DELETE FROM package_dependencies
         WHERE audit_id = ?
           AND NOT EXISTS (SELECT 1 FROM audit_reports WHERE audit_id = ?)`,
      )
      .bind(report.audit_id, report.audit_id),
    db
      .prepare(
        `DELETE FROM package_audits
         WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM audit_reports WHERE audit_id = ?)`,
      )
      .bind(report.audit_id, report.audit_id),
  ]);

  return true;
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
