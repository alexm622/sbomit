import type { AuditResult, LibraryContext } from "./audit";
import type { EnrichmentSignals } from "./signals";

export interface ScoreWeights {
  maxSecurity: number;
  maxTransparency: number;
  maxLicense: number;
  maxMaintenance: number;
  maxDependencyHealth: number;
  advisoryWeights: Record<string, number>;
  findingWeights: Record<string, number>;
  maintenancePenalties: Array<{ days: number; penalty: number }>;
  licenseIncompatiblePenalty: number;
  singleMaintainerPenalty: number;
  lowDownloadPenalty: number;
  highDownloadBonus: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  maxSecurity: 40,
  maxTransparency: 30,
  maxLicense: 10,
  maxMaintenance: 10,
  maxDependencyHealth: 10,
  advisoryWeights: { critical: 15, high: 10, medium: 5, low: 2, default: 4 },
  findingWeights: { critical: 10, high: 6, medium: 3, low: 1, default: 2 },
  maintenancePenalties: [
    { days: 365, penalty: 0 },
    { days: 730, penalty: 3 },
    { days: 1095, penalty: 6 },
  ],
  licenseIncompatiblePenalty: 10,
  singleMaintainerPenalty: 2,
  lowDownloadPenalty: 2,
  highDownloadBonus: 2,
};

function severityDeduction(
  items: Array<{ severity: string | null | undefined }>,
  weights: Record<string, number>,
  maxDeduction: number,
): number {
  let total = 0;
  for (const item of items) {
    const key = item.severity ?? "default";
    total += weights[key] ?? weights.default ?? 0;
  }
  return Math.min(total, maxDeduction);
}

export function daysSince(dateString: string | undefined): number | undefined {
  if (!dateString) return undefined;
  const parsed = Date.parse(dateString);
  if (Number.isNaN(parsed)) return undefined;
  const ms = Date.now() - parsed;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

interface NpmMetadata {
  time?: Record<string, string>;
}

interface GitHubRepo {
  pushed_at?: string;
  updated_at?: string;
}

function getLastPublishedDays(
  result: AuditResult,
  context: LibraryContext,
): number | undefined {
  const version = result.version || context.version;

  if (context.source === "npm") {
    const meta = context.metadata as NpmMetadata;
    const versionTime = meta.time?.[version];
    const fallback = meta.time?.["modified"] ?? meta.time?.["created"];
    return daysSince(versionTime) ?? daysSince(fallback);
  }

  if (context.source === "github") {
    const repo = context.metadata as GitHubRepo;
    return daysSince(repo.pushed_at) ?? daysSince(repo.updated_at);
  }

  return undefined;
}

export function dependencyHealthScore(result: AuditResult): number {
  const direct = result.dependencies.filter((d) => !d.transitive).length;
  const transitive = result.dependencies.filter((d) => d.transitive).length;

  let score = 0;
  if (direct === 0) score = 10;
  else if (direct <= 5) score = 8;
  else if (direct <= 15) score = 5;
  else score = 2;

  if (transitive > 20) score -= 2;
  if (transitive > 50) score -= 2;

  return Math.max(0, score);
}

export function maintenanceScore(
  result: AuditResult,
  context: LibraryContext,
  signals?: EnrichmentSignals,
): number {
  const days = signals?.lastPublished
    ? daysSince(signals.lastPublished)
    : getLastPublishedDays(result, context);

  if (days === undefined) return 5; // unknown, partial credit
  if (days <= 365) return 10;
  if (days <= 730) return 7;
  if (days <= 1095) return 4;
  return 1;
}

function signalAdjustment(signals: EnrichmentSignals | undefined): number {
  if (!signals) return 0;

  let adjustment = 0;

  if (signals.maintainerCount === 1) {
    adjustment -= DEFAULT_WEIGHTS.singleMaintainerPenalty;
  }

  if (signals.weeklyDownloads !== undefined) {
    if (signals.weeklyDownloads < 1000) {
      adjustment -= DEFAULT_WEIGHTS.lowDownloadPenalty;
    } else if (signals.weeklyDownloads > 1_000_000) {
      adjustment += DEFAULT_WEIGHTS.highDownloadBonus;
    }
  }

  return adjustment;
}

/**
 * Compute a deterministic 0-100 trust score from enrichment signals and the
 * structured audit result.
 *
 * The rubric is additive by category so each dimension is independently
 * inspectable. The LLM-provided score is intentionally ignored in favor of
 * this deterministic calculation.
 */
export function computeScore(
  result: AuditResult,
  context: LibraryContext,
  signals?: EnrichmentSignals,
): number {
  // Security: 0-40 points based on objective advisories and evidence-backed findings.
  const advisoryItems = signals?.advisories ?? result.cves;
  const cveDeduction = severityDeduction(
    advisoryItems,
    DEFAULT_WEIGHTS.advisoryWeights,
    DEFAULT_WEIGHTS.maxSecurity,
  );
  const findingDeduction = severityDeduction(
    result.deepDiveFindings,
    DEFAULT_WEIGHTS.findingWeights,
    DEFAULT_WEIGHTS.maxSecurity,
  );
  const securityScore = Math.max(
    0,
    DEFAULT_WEIGHTS.maxSecurity - cveDeduction - findingDeduction,
  );

  // Transparency: 0-30 points. Source inspection is a strong objective signal.
  const sourceInspected =
    !!context.codebase && context.codebase.files.length > 0;
  const transparencyScore = sourceInspected
    ? DEFAULT_WEIGHTS.maxTransparency
    : Math.floor(DEFAULT_WEIGHTS.maxTransparency / 3);

  // License: 0-10 points.
  const licenseScore = result.license.compatible
    ? DEFAULT_WEIGHTS.maxLicense
    : 0;

  // Maintenance: 0-10 points from actual publish/push dates or signals.
  const maintenance = maintenanceScore(result, context, signals);

  // Dependency health: 0-10 points from dependency counts.
  const dependencyHealth = dependencyHealthScore(result);

  const adjustment = signalAdjustment(signals);

  const score =
    securityScore +
    transparencyScore +
    licenseScore +
    maintenance +
    dependencyHealth +
    adjustment;

  return Math.min(100, Math.max(0, Math.round(score)));
}
