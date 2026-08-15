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
  return (data.vulns ?? []).map(normalizeOsvVulnerability);
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
