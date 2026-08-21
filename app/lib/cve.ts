import { UpstreamRateLimitError } from "./errors";

export interface CveReference {
  type: string | null;
  url: string;
}

export interface Cve {
  id: string;
  aliases: string[];
  severity: "critical" | "high" | "medium" | "low" | null;
  title: string;
  description: string;
  published: string | null;
  modified: string | null;
  fixedVersion: string | null;
  references: CveReference[];
}

interface OsvAffected {
  package?: {
    ecosystem?: string;
    name?: string;
  };
  ranges?: Array<{
    type?: string;
    events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }>;
  }>;
  versions?: string[];
}

interface OsvInterval {
  introduced: string;
  fixed?: string;
  last_affected?: string;
}

interface OsvVulnerability {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: Array<{
    type?: string;
    score?: string;
  }>;
  published?: string;
  modified?: string;
  references?: Array<{ type?: string; url: string }>;
  affected?: OsvAffected[];
}

interface OsvQueryResponse {
  vulns?: OsvVulnerability[];
}

function parseSemver(version: string): number[] | undefined {
  // Strip leading 'v' and any build/prerelease metadata for comparison.
  const cleaned = version.replace(/^v/, "").replace(/[+-].*$/, "");
  const parts = cleaned.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) {
    return undefined;
  }
  return parts;
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    // Fall back to lexicographic comparison for non-semver strings.
    return a.localeCompare(b);
  }
  const maxLen = Math.max(pa.length, pb.length);
  for (let i = 0; i < maxLen; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function parseIntervals(
  events: Array<{ introduced?: string; fixed?: string; last_affected?: string }>,
): OsvInterval[] {
  const intervals: OsvInterval[] = [];
  let current: OsvInterval | null = null;

  for (const event of events) {
    if (event.introduced !== undefined) {
      current = { introduced: event.introduced };
      intervals.push(current);
    }
    if (current) {
      if (event.fixed !== undefined) {
        current.fixed = event.fixed;
        current = null;
      } else if (event.last_affected !== undefined) {
        current.last_affected = event.last_affected;
        current = null;
      }
    }
  }

  return intervals;
}

function versionInInterval(version: string, interval: OsvInterval): boolean {
  const afterIntroduced =
    interval.introduced === "0" || compareSemver(version, interval.introduced) >= 0;
  if (!afterIntroduced) return false;

  if (interval.fixed !== undefined && compareSemver(version, interval.fixed) >= 0) {
    return false;
  }

  if (
    interval.last_affected !== undefined &&
    compareSemver(version, interval.last_affected) > 0
  ) {
    return false;
  }

  return true;
}

function hasAffectedRangeData(affected: OsvAffected): boolean {
  return (
    (affected.versions !== undefined && affected.versions.length > 0) ||
    (affected.ranges !== undefined && affected.ranges.length > 0)
  );
}

function isVulnerabilityAffectingVersion(
  version: string,
  vuln: OsvVulnerability,
): boolean {
  const affected = vuln.affected ?? [];
  if (affected.length === 0 || !affected.some(hasAffectedRangeData)) {
    // No usable range data: keep the advisory and let downstream logic decide.
    return true;
  }

  for (const aff of affected) {
    if (!hasAffectedRangeData(aff)) continue;

    // Explicit affected-version list is authoritative when present.
    if (aff.versions && aff.versions.length > 0) {
      if (aff.versions.includes(version)) return true;
      // If versions are listed but ours isn't, still fall through to ranges
      // because some OSV entries use both and the list may be incomplete.
    }

    for (const range of aff.ranges ?? []) {
      const intervals = parseIntervals(range.events ?? []);
      for (const interval of intervals) {
        if (versionInInterval(version, interval)) return true;
      }
    }
  }

  return false;
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  return Number.isNaN(seconds) ? undefined : seconds;
}

function extractSeverity(vuln: OsvVulnerability): Cve["severity"] {
  // Prefer CVSS v3 base score, fall back to first severity entry.
  for (const entry of vuln.severity ?? []) {
    const score = parseFloat(entry.score ?? "");
    if (!Number.isNaN(score)) {
      if (score >= 9.0) return "critical";
      if (score >= 7.0) return "high";
      if (score >= 4.0) return "medium";
      if (score > 0) return "low";
    }
  }
  return null;
}

function extractFixedVersion(vuln: OsvVulnerability): string | undefined {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return undefined;
}

function normalizeOsvVulnerability(vuln: OsvVulnerability): Cve {
  return {
    id: vuln.id,
    aliases: vuln.aliases ?? [],
    severity: extractSeverity(vuln) ?? null,
    title: vuln.summary ?? vuln.id,
    description: vuln.details ?? "",
    published: vuln.published ?? null,
    modified: vuln.modified ?? null,
    fixedVersion: extractFixedVersion(vuln) ?? null,
    references:
      vuln.references?.map((ref) => ({
        type: ref.type ?? null,
        url: ref.url,
      })) ?? [],
  };
}

export async function fetchNpmVulnerabilities(
  name: string,
  version: string,
): Promise<Cve[]> {
  const res = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      package: {
        ecosystem: "npm",
        name,
      },
      version,
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new UpstreamRateLimitError("OSV API", parseRetryAfter(res));
    }
    return [];
  }

  const data = (await res.json()) as OsvQueryResponse;
  return (data.vulns ?? [])
    .filter((vuln) => isVulnerabilityAffectingVersion(version, vuln))
    .map(normalizeOsvVulnerability);
}

export async function fetchGitHubCommitForRef(
  owner: string,
  repo: string,
  ref: string,
): Promise<string | undefined> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "sbomit-audit",
      },
    },
  );
  if (!res.ok) {
    return undefined;
  }
  const data = (await res.json()) as { sha?: string };
  return data.sha;
}

export async function fetchGitHubVulnerabilities(
  owner: string,
  repo: string,
  ref: string,
): Promise<Cve[]> {
  const commit = await fetchGitHubCommitForRef(owner, repo, ref);
  if (!commit) {
    return [];
  }

  const res = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      commit,
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new UpstreamRateLimitError("OSV API", parseRetryAfter(res));
    }
    return [];
  }

  const data = (await res.json()) as OsvQueryResponse;
  return (data.vulns ?? []).map(normalizeOsvVulnerability);
}

export function cveToText(cves: Cve[]): string {
  if (cves.length === 0) {
    return "No known CVEs or security advisories were found for this version.";
  }
  return cves
    .map(
      (cve) =>
        `- ${cve.id} (${cve.severity ?? "unknown"}): ${cve.title}` +
        (cve.fixedVersion ? ` (fixed in ${cve.fixedVersion})` : ""),
    )
    .join("\n");
}
