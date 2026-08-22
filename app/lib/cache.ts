import { getAuditReportByCacheKey, type StoredAuditReport } from "./db";

const LATEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Determine whether a version string looks like a pinned release.
 *
 * "latest", branch names, and ranges are treated as mutable and cached for
 * only 24 hours. Semver triples (e.g. 1.2.3) are considered immutable.
 */
export function isVersionPinned(version: string): boolean {
  return /^\d+\.\d+\.\d+/.test(version);
}

/**
 * Check whether a cached audit report is stale.
 *
 * Pinned versions never expire; mutable versions expire after 24 hours.
 */
export function isCacheExpired(
  report: StoredAuditReport,
  version: string,
): boolean {
  if (isVersionPinned(version)) return false;
  const created = new Date(report.created_at).getTime();
  return Date.now() - created > LATEST_TTL_MS;
}

/**
 * Look up a cached audit report by cache key, respecting TTL policy.
 *
 * Expired entries are deleted so the database does not accumulate stale rows.
 */
export async function getCachedAuditReport(
  db: D1Database,
  cacheKey: string,
  version: string,
): Promise<StoredAuditReport | null> {
  const report = await getAuditReportByCacheKey(db, cacheKey);

  if (!report) return null;

  if (isCacheExpired(report, version)) {
    await db.prepare("DELETE FROM audit_reports WHERE id = ?").bind(report.id).run();
    return null;
  }

  return report;
}
