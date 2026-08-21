import { DbUnavailableError } from "./errors";
import type { AuditResult } from "./audit";
import type { Provider } from "./providers";

function generatePublicId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let i = 0; i < 12; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

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
  public_id: string;
  prompt: string | null;
  model: string;
  score: number;
  result_json: string;
  cache_key: string | null;
  interaction_json: string | null;
  codebase_inspected: number;
  tokens_total: number | null;
  provider_models: string | null;
  cached: number;
  cache_hits: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ProviderModelPair {
  providerId?: string;
  model: string;
}

export type StoredReport = StoredAuditReport;

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
  tokens_total: number | null;
  started_at: string | null;
  finished_at: string | null;
  codebase_inspected: number;
}

export interface StoredRisk {
  id: number;
  report_id: number;
  severity: string;
  title: string;
  description: string;
}

export interface StoredCve {
  id: number;
  report_id: number;
  cve_id: string;
  aliases: string | null;
  severity: string | null;
  title: string;
  description: string;
  published: string | null;
  modified: string | null;
  fixed_version: string | null;
  references_json: string | null;
}

export interface StoredFinding {
  id: number;
  report_id: number;
  area: string;
  file: string;
  issue: string;
  evidence: string | null;
  severity: string;
}

export interface StoredInvestigationArea {
  id: number;
  report_id: number;
  area: string;
  rationale: string;
}

export interface StoredInvestigationFile {
  id: number;
  area_id: number;
  file: string;
}

export interface StoredReportDependency {
  id: number;
  report_id: number;
  name: string;
  version: string;
  license: string;
  transitive: number;
}

export interface StoredReportFindings {
  risks: StoredRisk[];
  cves: StoredCve[];
  findings: StoredFinding[];
  investigationAreas: StoredInvestigationArea[];
  investigationFiles: StoredInvestigationFile[];
  dependencies: StoredReportDependency[];
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

function generateProviderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return generatePublicId();
}

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

export async function getDefaultProvider(
  db: D1Database,
): Promise<StoredProvider | null> {
  return db
    .prepare("SELECT * FROM providers WHERE is_default = 1 LIMIT 1")
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

export async function saveDependencyTree(
  db: D1Database,
  audit: {
    name: string;
    version: string;
    source: string;
    url: string;
    userId?: number;
  },
  dependencies: StoredDependency[],
): Promise<number> {
  const insertAudit = db
    .prepare(
      `INSERT INTO package_audits (name, version, source, url, user_id) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(audit.name, audit.version, audit.source, audit.url, audit.userId ?? null);

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

interface InteractionLike {
  tokensInput?: number | null;
  tokensOutput?: number | null;
}

function parseAuditResult(resultJson: string): AuditResult | undefined {
  try {
    return JSON.parse(resultJson) as AuditResult;
  } catch {
    return undefined;
  }
}

function computeTokensTotal(interactionJson: string | undefined): number | null {
  if (!interactionJson) return null;
  try {
    const parsed = JSON.parse(interactionJson) as
      | InteractionLike
      | InteractionLike[];
    const interactions = Array.isArray(parsed) ? parsed : [parsed];
    let total = 0;
    let hasTokens = false;
    for (const interaction of interactions) {
      if (interaction.tokensInput != null) {
        total += interaction.tokensInput;
        hasTokens = true;
      }
      if (interaction.tokensOutput != null) {
        total += interaction.tokensOutput;
        hasTokens = true;
      }
    }
    return hasTokens ? total : null;
  } catch {
    return null;
  }
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
    userId?: number;
    providerModels?: ProviderModelPair[];
    cached?: boolean;
    startedAt?: string;
    finishedAt?: string;
  },
): Promise<{ auditId: number; reportId: number }> {
  const insertAudit = db
    .prepare(
      `INSERT INTO package_audits (name, version, source, url, user_id) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(input.name, input.version, input.source, input.url, input.userId ?? null);

  const auditResult = await insertAudit.run<{ id: number }>();
  const auditId = auditResult.meta?.last_row_id as number | undefined;
  if (!auditId) {
    throw new Error("Failed to insert package audit.");
  }

  const publicId = generatePublicId();
  const tokensTotal = computeTokensTotal(input.interactionJson);
  const providerModelsJson =
    input.providerModels && input.providerModels.length > 0
      ? JSON.stringify(input.providerModels)
      : null;

  const insertReport = db
    .prepare(
      `INSERT INTO audit_reports (audit_id, public_id, prompt, model, score, result_json, cache_key, interaction_json, codebase_inspected, tokens_total, provider_models, cached, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      auditId,
      publicId,
      input.prompt ?? null,
      input.model,
      input.score,
      input.resultJson,
      input.cacheKey ?? null,
      input.interactionJson ?? null,
      input.codebaseInspected ? 1 : 0,
      tokensTotal,
      providerModelsJson,
      input.cached ? 1 : 0,
      input.startedAt ?? null,
      input.finishedAt ?? null,
    );

  const reportResult = await insertReport.run<{ id: number }>();
  const reportId = reportResult.meta?.last_row_id as number | undefined;
  if (!reportId) {
    throw new Error("Failed to insert audit report.");
  }

  // Persist all findings into normalized tables for querying and history views.
  const result = parseAuditResult(input.resultJson);
    if (result) {
    const statements: D1PreparedStatement[] = [];
    const risks = result.risks ?? [];
    const cves = result.cves ?? [];
    const investigationAreas = result.investigationAreas ?? [];
    const deepDiveFindings = result.deepDiveFindings ?? [];
    const dependencies = result.dependencies ?? [];

    if (risks.length > 0) {
      const insertRisk = db.prepare(
        `INSERT INTO audit_risks (report_id, severity, title, description) VALUES (?, ?, ?, ?)`,
      );
      for (const risk of risks) {
        statements.push(
          insertRisk.bind(reportId, risk.severity, risk.title, risk.description),
        );
      }
    }

    if (cves.length > 0) {
      const insertCve = db.prepare(
        `INSERT INTO audit_cves (report_id, cve_id, aliases, severity, title, description, published, modified, fixed_version, references_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const cve of cves) {
        statements.push(
          insertCve.bind(
            reportId,
            cve.id,
            JSON.stringify(cve.aliases),
            cve.severity,
            cve.title,
            cve.description,
            cve.published,
            cve.modified,
            cve.fixedVersion,
            JSON.stringify(cve.references),
          ),
        );
      }
    }

    const filesByAreaId = new Map<number, string[]>();
    if (investigationAreas.length > 0) {
      const insertArea = db.prepare(
        `INSERT INTO audit_investigation_areas (report_id, area, rationale) VALUES (?, ?, ?)`,
      );
      for (const area of investigationAreas) {
        const areaResult = await insertArea
          .bind(reportId, area.area, area.rationale)
          .run<{ id: number }>();
        const areaId = areaResult.meta?.last_row_id as number | undefined;
        const files = area.files ?? [];
        if (areaId && files.length > 0) {
          filesByAreaId.set(areaId, files);
        }
      }
    }

    if (filesByAreaId.size > 0) {
      const insertFile = db.prepare(
        `INSERT INTO audit_investigation_files (area_id, file) VALUES (?, ?)`,
      );
      for (const [areaId, files] of filesByAreaId) {
        for (const file of files) {
          statements.push(insertFile.bind(areaId, file));
        }
      }
    }

    if (deepDiveFindings.length > 0) {
      const insertFinding = db.prepare(
        `INSERT INTO audit_findings (report_id, area, file, issue, evidence, severity) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const finding of deepDiveFindings) {
        statements.push(
          insertFinding.bind(
            reportId,
            finding.area,
            finding.file,
            finding.issue,
            finding.evidence ?? null,
            finding.severity,
          ),
        );
      }
    }

    if (dependencies.length > 0) {
      const insertDep = db.prepare(
        `INSERT INTO audit_report_dependencies (report_id, name, version, license, transitive) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const dep of dependencies) {
        statements.push(
          insertDep.bind(
            reportId,
            dep.name,
            dep.version,
            dep.license,
            dep.transitive ? 1 : 0,
          ),
        );
      }
    }

    if (statements.length > 0) {
      await db.batch(statements);
    }
  }

  return { auditId, reportId };
}

export async function incrementCacheHits(
  db: D1Database,
  reportId: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE audit_reports SET cache_hits = COALESCE(cache_hits, 0) + 1 WHERE id = ?`,
    )
    .bind(reportId)
    .run();
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
              r.tokens_total,
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

export async function getRisksByReportId(
  db: D1Database,
  reportId: number,
): Promise<StoredRisk[]> {
  const result = await db
    .prepare("SELECT * FROM audit_risks WHERE report_id = ? ORDER BY id")
    .bind(reportId)
    .all<StoredRisk>();
  return result.results || [];
}

export async function getCvesByReportId(
  db: D1Database,
  reportId: number,
): Promise<StoredCve[]> {
  const result = await db
    .prepare("SELECT * FROM audit_cves WHERE report_id = ? ORDER BY id")
    .bind(reportId)
    .all<StoredCve>();
  return result.results || [];
}

export async function getFindingsByReportId(
  db: D1Database,
  reportId: number,
): Promise<StoredFinding[]> {
  const result = await db
    .prepare("SELECT * FROM audit_findings WHERE report_id = ? ORDER BY id")
    .bind(reportId)
    .all<StoredFinding>();
  return result.results || [];
}

export async function getInvestigationAreasByReportId(
  db: D1Database,
  reportId: number,
): Promise<StoredInvestigationArea[]> {
  const result = await db
    .prepare(
      "SELECT * FROM audit_investigation_areas WHERE report_id = ? ORDER BY id",
    )
    .bind(reportId)
    .all<StoredInvestigationArea>();
  return result.results || [];
}

export async function getInvestigationFilesByAreaId(
  db: D1Database,
  areaId: number,
): Promise<StoredInvestigationFile[]> {
  const result = await db
    .prepare(
      "SELECT * FROM audit_investigation_files WHERE area_id = ? ORDER BY id",
    )
    .bind(areaId)
    .all<StoredInvestigationFile>();
  return result.results || [];
}

export async function getReportDependenciesByReportId(
  db: D1Database,
  reportId: number,
): Promise<StoredReportDependency[]> {
  const result = await db
    .prepare(
      "SELECT * FROM audit_report_dependencies WHERE report_id = ? ORDER BY id",
    )
    .bind(reportId)
    .all<StoredReportDependency>();
  return result.results || [];
}

export async function getAuditReportFindings(
  db: D1Database,
  reportId: number,
): Promise<StoredReportFindings> {
  const [risks, cves, findings, investigationAreas, dependencies] =
    await Promise.all([
      getRisksByReportId(db, reportId),
      getCvesByReportId(db, reportId),
      getFindingsByReportId(db, reportId),
      getInvestigationAreasByReportId(db, reportId),
      getReportDependenciesByReportId(db, reportId),
    ]);

  const areaIds = investigationAreas.map((a) => a.id);
  const investigationFiles =
    areaIds.length > 0
      ? await db
          .prepare(
            `SELECT * FROM audit_investigation_files WHERE area_id IN (${areaIds.map(() => "?").join(", ")}) ORDER BY id`,
          )
          .bind(...areaIds)
          .all<StoredInvestigationFile>()
          .then((r) => r.results || [])
      : [];

  return {
    risks,
    cves,
    findings,
    investigationAreas,
    investigationFiles,
    dependencies,
  };
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

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface StoredUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  password_hash: string;
  is_admin: number;
  is_blocked: number;
  created_at: string;
  updated_at: string;
}

export interface UserInput {
  username: string;
  email: string;
  fullName: string;
  passwordHash: string;
  isAdmin?: boolean;
}

export async function createUser(
  db: D1Database,
  input: UserInput,
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO users (username, email, full_name, password_hash, is_admin)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      input.username,
      input.email,
      input.fullName,
      input.passwordHash,
      input.isAdmin ? 1 : 0,
    )
    .run<{ id: number }>();
  return result.meta?.last_row_id as number;
}

export async function getUserById(
  db: D1Database,
  id: number,
): Promise<StoredUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .bind(id)
    .first<StoredUser>();
}

export async function getUserByUsername(
  db: D1Database,
  username: string,
): Promise<StoredUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE username = ? LIMIT 1")
    .bind(username)
    .first<StoredUser>();
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<StoredUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<StoredUser>();
}

export async function listUsers(
  db: D1Database,
  options: { search?: string; limit?: number; offset?: number } = {},
): Promise<StoredUser[]> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (options.search) {
    const pattern = `%${options.search}%`;
    const result = await db
      .prepare(
        `SELECT * FROM users
         WHERE username LIKE ? OR email LIKE ? OR full_name LIKE ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(pattern, pattern, pattern, limit, offset)
      .all<StoredUser>();
    return result.results || [];
  }
  const result = await db
    .prepare(
      `SELECT * FROM users ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<StoredUser>();
  return result.results || [];
}

export async function updateUser(
  db: D1Database,
  id: number,
  input: {
    email?: string;
    fullName?: string;
    passwordHash?: string;
    isAdmin?: boolean;
    isBlocked?: boolean;
  },
): Promise<boolean> {
  const existing = await getUserById(db, id);
  if (!existing) return false;

  const email = input.email ?? existing.email;
  const fullName = input.fullName ?? existing.full_name;
  const passwordHash = input.passwordHash ?? existing.password_hash;
  const isAdmin = input.isAdmin !== undefined ? (input.isAdmin ? 1 : 0) : existing.is_admin;
  const isBlocked = input.isBlocked !== undefined ? (input.isBlocked ? 1 : 0) : existing.is_blocked;

  const result = await db
    .prepare(
      `UPDATE users
       SET email = ?, full_name = ?, password_hash = ?, is_admin = ?, is_blocked = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(email, fullName, passwordHash, isAdmin, isBlocked, id)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function deleteUser(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function isEmailBlocked(
  db: D1Database,
  email: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS blocked FROM blocked_emails WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ blocked: number }>();
  return Boolean(row?.blocked);
}

export async function isUsernameBlocked(
  db: D1Database,
  username: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS blocked FROM blocked_usernames WHERE username = ? LIMIT 1")
    .bind(username)
    .first<{ blocked: number }>();
  return Boolean(row?.blocked);
}

export async function addBlockedEmail(
  db: D1Database,
  email: string,
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO blocked_emails (email) VALUES (?)")
    .bind(email)
    .run();
}

export async function removeBlockedEmail(
  db: D1Database,
  email: string,
): Promise<void> {
  await db.prepare("DELETE FROM blocked_emails WHERE email = ?").bind(email).run();
}

export async function listBlockedEmails(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT email FROM blocked_emails ORDER BY email")
    .all<{ email: string }>();
  return (result.results || []).map((r) => r.email);
}

export async function addBlockedUsername(
  db: D1Database,
  username: string,
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO blocked_usernames (username) VALUES (?)")
    .bind(username)
    .run();
}

export async function removeBlockedUsername(
  db: D1Database,
  username: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM blocked_usernames WHERE username = ?")
    .bind(username)
    .run();
}

export async function listBlockedUsernames(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT username FROM blocked_usernames ORDER BY username")
    .all<{ username: string }>();
  return (result.results || []).map((r) => r.username);
}

// ---------------------------------------------------------------------------
// Provider limits
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// User and overall statistics
// ---------------------------------------------------------------------------

export interface UserStats {
  auditsRun: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  successes: number;
  failures: number;
}

export async function getUserStats(
  db: D1Database,
  userId: number,
): Promise<UserStats> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(r.id) AS audits_run,
         COALESCE(SUM(JSON_EXTRACT(r.interaction_json, '$.tokensInput')), 0) AS tokens_input,
         COALESCE(SUM(JSON_EXTRACT(r.interaction_json, '$.tokensOutput')), 0) AS tokens_output,
         COALESCE(SUM(r.tokens_total), 0) AS tokens_total,
         COALESCE(SUM(CASE WHEN r.score IS NOT NULL THEN 1 ELSE 0 END), 0) AS successes,
         0 AS failures
       FROM package_audits a
       JOIN audit_reports r ON r.audit_id = a.id
       WHERE a.user_id = ?`,
    )
    .bind(userId)
    .first<{
      audits_run: number;
      tokens_input: number;
      tokens_output: number;
      tokens_total: number;
      successes: number;
      failures: number;
    }>();

  return {
    auditsRun: Number(row?.audits_run ?? 0),
    tokensInput: Number(row?.tokens_input ?? 0),
    tokensOutput: Number(row?.tokens_output ?? 0),
    tokensTotal: Number(row?.tokens_total ?? 0),
    successes: Number(row?.successes ?? 0),
    failures: Number(row?.failures ?? 0),
  };
}

export async function listUserAuditReports(
  db: D1Database,
  userId: number,
): Promise<StoredAuditReportSummary[]> {
  const result = await db
    .prepare(
      `SELECT r.id, r.audit_id, r.prompt, r.model, r.score, r.created_at,
              a.name, a.version, a.source, a.url,
              JSON_EXTRACT(r.interaction_json, '$.provider') AS provider,
              JSON_EXTRACT(r.interaction_json, '$.tokensInput') AS tokens_input,
              JSON_EXTRACT(r.interaction_json, '$.tokensOutput') AS tokens_output,
              r.tokens_total,
              JSON_EXTRACT(r.interaction_json, '$.startedAt') AS started_at,
              JSON_EXTRACT(r.interaction_json, '$.finishedAt') AS finished_at,
              r.codebase_inspected
       FROM audit_reports r
       JOIN package_audits a ON a.id = r.audit_id
       WHERE a.user_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
    )
    .bind(userId)
    .all<StoredAuditReportSummary>();
  return result.results || [];
}

export interface ModelTokenBreakdown {
  model: string;
  tokens: number;
  audits: number;
  avgTokens: number;
}

export interface ProviderTokenBreakdown {
  provider: string;
  tokens: number;
  audits: number;
  avgTokens: number;
}

export interface TokensOverTime {
  date: string;
  tokens: number;
  audits: number;
}

export interface ScoreDistribution {
  range: string;
  audits: number;
}

export interface DailyActiveUsers {
  date: string;
  users: number;
}

export interface ProviderBudgetUtilization {
  id: string;
  name: string;
  limit: number;
  used: number;
  pct: number;
}

export interface TopUser {
  id: number;
  username: string;
  fullName: string;
  auditsRun: number;
  tokensTotal: number;
}

export interface OverallStats {
  totalAudits: number;
  totalUsers: number;
  totalTokens: number;
  tokensToday: number;
  auditsToday: number;
  avgTokensPerAudit: number;
  estimatedSpend: number;
  cacheHitRate: number;
  avgAuditDurationMs: number;
  tokensOverTime: TokensOverTime[];
  tokensByModel: ModelTokenBreakdown[];
  tokensByProvider: ProviderTokenBreakdown[];
  scoreDistribution: ScoreDistribution[];
  dailyActiveUsers: DailyActiveUsers[];
  providerBudgetUtilization: ProviderBudgetUtilization[];
  topUsers: TopUser[];
}

// Rough per-model pricing in USD per 1M tokens. Used for cost estimates.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o1-mini": { input: 1.1, output: 4.4 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "gemini-1.5-flash-latest": { input: 0.35, output: 0.53 },
  "gemini-1.5-pro-latest": { input: 3.5, output: 10.5 },
  "kimi-k2.7-code": { input: 0.5, output: 2 },
  "kimi-k3": { input: 2, output: 8 },
  "moonshot-v1-8k": { input: 0.5, output: 1.5 },
};

const DEFAULT_PRICING = { input: 2, output: 6 };

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// Aggregate per-interaction tokens across audit reports. Handles both a single
// interaction object and an array of interactions stored in interaction_json.
// It also infers a more specific provider name (e.g. Moonshot, DeepSeek) from
// the model when an OpenAI-compatible endpoint was used.
const interactionBreakdownCte = `
  interactions AS (
    SELECT
      r.id,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN JSON_EXTRACT(j.value, '$.provider')
        ELSE JSON_EXTRACT(r.interaction_json, '$.provider')
      END AS provider,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN JSON_EXTRACT(j.value, '$.providerId')
        ELSE JSON_EXTRACT(r.interaction_json, '$.providerId')
      END AS provider_id,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN JSON_EXTRACT(j.value, '$.model')
        ELSE JSON_EXTRACT(r.interaction_json, '$.model')
      END AS model,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN
          COALESCE(JSON_EXTRACT(j.value, '$.tokensInput'), 0)
        ELSE
          COALESCE(JSON_EXTRACT(r.interaction_json, '$.tokensInput'), 0)
      END AS input_tokens,
      CASE
        WHEN JSON_TYPE(r.interaction_json) = 'array' THEN
          COALESCE(JSON_EXTRACT(j.value, '$.tokensOutput'), 0)
        ELSE
          COALESCE(JSON_EXTRACT(r.interaction_json, '$.tokensOutput'), 0)
      END AS output_tokens
    FROM audit_reports r
    LEFT JOIN JSON_EACH(r.interaction_json) AS j ON JSON_TYPE(r.interaction_json) = 'array'
  ),
  inferred AS (
    SELECT
      id,
      provider_id,
      CASE
        WHEN provider = 'openai' AND (LOWER(model) LIKE '%moonshot%' OR LOWER(model) LIKE '%kimi%') THEN 'moonshot'
        WHEN provider = 'openai' AND LOWER(model) LIKE '%deepseek%' THEN 'deepseek'
        ELSE provider
      END AS provider,
      model,
      input_tokens,
      output_tokens,
      input_tokens + output_tokens AS tokens
    FROM interactions
  )
`;

export async function getOverallStats(db: D1Database): Promise<OverallStats> {
  const today = new Date().toISOString().slice(0, 10);
  const [
    totals,
    overTime,
    duration,
    scoreDistribution,
    dailyActiveUsers,
    providerBudget,
    byModel,
    byProvider,
    topUsers,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM audit_reports) AS total_audits,
           (SELECT COUNT(*) FROM users) AS total_users,
           (SELECT COALESCE(SUM(tokens_total), 0) FROM audit_reports) AS total_tokens,
           (SELECT COALESCE(SUM(tokens_total), 0) FROM provider_usage WHERE usage_date = ?) AS tokens_today,
           (SELECT COUNT(*) FROM audit_reports WHERE created_at >= datetime('now', 'start of day')) AS audits_today,
           (SELECT COALESCE(SUM(cache_hits), 0) FROM audit_reports) AS total_cache_hits`,
      )
      .bind(today)
      .first<{
        total_audits: number;
        total_users: number;
        total_tokens: number;
        tokens_today: number;
        audits_today: number;
        total_cache_hits: number;
      }>(),
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at) AS date,
                COALESCE(SUM(tokens_total), 0) AS tokens,
                COUNT(*) AS audits
         FROM audit_reports
         WHERE created_at >= datetime('now', '-30 days')
         GROUP BY date
         ORDER BY date ASC`,
      )
      .all<{ date: string; tokens: number; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT AVG(
           (julianday(finished_at) - julianday(started_at)) * 24 * 60 * 60 * 1000
         ) AS avg_duration_ms
         FROM audit_reports
         WHERE cached = 0 AND started_at IS NOT NULL AND finished_at IS NOT NULL`,
      )
      .first<{ avg_duration_ms: number }>(),
    db
      .prepare(
        `SELECT
           CASE
             WHEN score >= 90 THEN '90-100'
             WHEN score >= 80 THEN '80-89'
             WHEN score >= 70 THEN '70-79'
             WHEN score >= 60 THEN '60-69'
             WHEN score >= 50 THEN '50-59'
             ELSE '0-49'
           END AS range,
           COUNT(*) AS audits
         FROM audit_reports
         GROUP BY range
         ORDER BY range DESC`,
      )
      .all<{ range: string; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', r.created_at) AS date, COUNT(DISTINCT a.user_id) AS users
         FROM audit_reports r
         JOIN package_audits a ON a.id = r.audit_id
         WHERE r.created_at >= datetime('now', '-30 days')
         GROUP BY date
         ORDER BY date ASC`,
      )
      .all<{ date: string; users: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT
           p.id,
           p.name,
           pl.daily_token_limit AS daily_limit,
           COALESCE((SELECT SUM(tokens_total) FROM provider_usage WHERE provider_id = p.id AND usage_date = ?), 0) AS used
         FROM providers p
         JOIN provider_limits pl ON pl.provider_id = p.id
         ORDER BY p.name`,
      )
      .bind(today)
      .all<{ id: string; name: string; daily_limit: number; used: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `WITH ${interactionBreakdownCte}
         SELECT model, SUM(tokens) AS tokens, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(DISTINCT id) AS audits
         FROM inferred
         WHERE model IS NOT NULL
         GROUP BY model
         ORDER BY tokens DESC`,
      )
      .all<{ model: string; tokens: number; input_tokens: number; output_tokens: number; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `WITH ${interactionBreakdownCte}
         SELECT COALESCE(p.name, i.provider) AS provider, SUM(i.tokens) AS tokens, COUNT(DISTINCT i.id) AS audits
         FROM inferred i
         LEFT JOIN providers p ON p.id = i.provider_id
         WHERE i.provider IS NOT NULL OR p.name IS NOT NULL
         GROUP BY COALESCE(p.id, i.provider), COALESCE(p.name, i.provider)
         ORDER BY tokens DESC`,
      )
      .all<{ provider: string; tokens: number; audits: number }>()
      .then((r) => r.results || []),
    db
      .prepare(
        `SELECT
           u.id,
           u.username,
           u.full_name,
           COUNT(r.id) AS audits_run,
           COALESCE(SUM(r.tokens_total), 0) AS tokens_total
         FROM users u
         JOIN package_audits a ON a.user_id = u.id
         JOIN audit_reports r ON r.audit_id = a.id
         GROUP BY u.id, u.username, u.full_name
         ORDER BY tokens_total DESC
         LIMIT 10`,
      )
      .all<{ id: number; username: string; full_name: string; audits_run: number; tokens_total: number }>()
      .then((r) => r.results || []),
  ]);

  const totalAudits = Number(totals?.total_audits ?? 0);
  const totalTokens = Number(totals?.total_tokens ?? 0);
  const totalCacheHits = Number(totals?.total_cache_hits ?? 0);
  const cacheRequests = totalCacheHits + totalAudits;

  const tokensByModel = byModel.map((row) => ({
    model: row.model,
    tokens: Number(row.tokens),
    audits: Number(row.audits),
    avgTokens: row.audits > 0 ? Math.round(Number(row.tokens) / Number(row.audits)) : 0,
  }));

  const estimatedSpend = byModel.reduce(
    (sum, row) =>
      sum +
      estimateCost(
        row.model,
        Number(row.input_tokens),
        Number(row.output_tokens),
      ),
    0,
  );

  return {
    totalAudits,
    totalUsers: Number(totals?.total_users ?? 0),
    totalTokens,
    tokensToday: Number(totals?.tokens_today ?? 0),
    auditsToday: Number(totals?.audits_today ?? 0),
    avgTokensPerAudit: totalAudits > 0 ? Math.round(totalTokens / totalAudits) : 0,
    estimatedSpend: Math.round(estimatedSpend * 100) / 100,
    cacheHitRate: cacheRequests > 0 ? Math.round((totalCacheHits / cacheRequests) * 1000) / 10 : 0,
    avgAuditDurationMs: Math.round(Number(duration?.avg_duration_ms ?? 0)),
    tokensOverTime: overTime.map((row) => ({
      date: row.date,
      tokens: Number(row.tokens),
      audits: Number(row.audits),
    })),
    tokensByModel,
    tokensByProvider: byProvider.map((row) => ({
      provider: row.provider,
      tokens: Number(row.tokens),
      audits: Number(row.audits),
      avgTokens: row.audits > 0 ? Math.round(Number(row.tokens) / Number(row.audits)) : 0,
    })),
    scoreDistribution: scoreDistribution.map((row) => ({
      range: row.range,
      audits: Number(row.audits),
    })),
    dailyActiveUsers: dailyActiveUsers.map((row) => ({
      date: row.date,
      users: Number(row.users),
    })),
    providerBudgetUtilization: providerBudget.map((row) => ({
      id: row.id,
      name: row.name,
      limit: Number(row.daily_limit),
      used: Number(row.used),
      pct: row.daily_limit > 0 ? Math.round((Number(row.used) / Number(row.daily_limit)) * 1000) / 10 : 0,
    })),
    topUsers: topUsers.map((row) => ({
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      auditsRun: Number(row.audits_run),
      tokensTotal: Number(row.tokens_total),
    })),
  };
}
