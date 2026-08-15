import { fetchGitHubVulnerabilities, fetchNpmVulnerabilities, type Cve } from "./cve";

export interface LibraryIdentity {
  source: "npm" | "github";
  url: string;
  name: string;
  version: string;
  metadata: unknown;
}

export interface EnrichmentSignals {
  /** Security advisories from OSV / npm / GitHub. */
  advisories: Cve[];
  /** ISO timestamp of the last publish (npm) or push (GitHub). */
  lastPublished?: string;
  /** Weekly download count from the npm downloads API. */
  weeklyDownloads?: number;
  /** Number of maintainers (npm) or a conservative public-collaborator proxy (GitHub). */
  maintainerCount?: number;
  /** Normalized SPDX license id. */
  licenseSpdx?: string;
  /** GitHub-only: repository star count. */
  repoStars?: number;
  /** GitHub-only: repository fork count. */
  repoForks?: number;
  /** GitHub-only: open issues count. */
  repoOpenIssues?: number;
  /** GitHub-only: last push timestamp. */
  repoPushedAt?: string;
}

export interface EnrichmentOptions {
  /** Fetch weekly download counts from npm. Default true. */
  fetchDownloads?: boolean;
}

interface NpmMetadata {
  name?: string;
  time?: Record<string, string>;
  license?: string | { type?: string };
  maintainers?: Array<{ name?: string; email?: string }>;
}

interface GitHubRepo {
  full_name?: string;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  pushed_at?: string;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
}

function parseGitHubOwnerRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("github.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

function normalizeLicense(license: unknown): string | undefined {
  if (typeof license === "string") return license || undefined;
  if (license && typeof license === "object" && !Array.isArray(license)) {
    const typed = license as { type?: string; spdx_id?: string | null };
    return typed.spdx_id ?? typed.type ?? undefined;
  }
  return undefined;
}

async function fetchNpmDownloads(name: string): Promise<number | undefined> {
  try {
    const res = await fetch(
      `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
      { next: { revalidate: 0 } },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { downloads?: number };
    return typeof data.downloads === "number" ? data.downloads : undefined;
  } catch {
    return undefined;
  }
}

async function fetchNpmSignals(
  identity: LibraryIdentity,
  options: EnrichmentOptions,
): Promise<Partial<EnrichmentSignals>> {
  const metadata = identity.metadata as NpmMetadata;
  const signals: Partial<EnrichmentSignals> = {};

  const versionTime = metadata.time?.[identity.version];
  const fallback = metadata.time?.["modified"] ?? metadata.time?.["created"];
  signals.lastPublished = versionTime ?? fallback;

  signals.licenseSpdx = normalizeLicense(metadata.license);
  signals.maintainerCount = metadata.maintainers?.length;

  if (options.fetchDownloads !== false) {
    signals.weeklyDownloads = await fetchNpmDownloads(identity.name);
  }

  return signals;
}

async function fetchGitHubSignals(
  identity: LibraryIdentity,
): Promise<Partial<EnrichmentSignals>> {
  const metadata = identity.metadata as GitHubRepo;
  const signals: Partial<EnrichmentSignals> = {};

  signals.repoPushedAt = metadata.pushed_at;
  signals.lastPublished = metadata.pushed_at;
  signals.licenseSpdx = metadata.license?.spdx_id ?? undefined;
  signals.repoStars = metadata.stargazers_count;
  signals.repoForks = metadata.forks_count;
  signals.repoOpenIssues = metadata.open_issues_count;
  // Public repos do not expose collaborator counts without auth; use a
  // conservative default of 1 (the owner organization) so the rubric can still
  // flag potential bus-factor risk.
  signals.maintainerCount = 1;

  return signals;
}

async function fetchAdvisories(identity: LibraryIdentity): Promise<Cve[]> {
  try {
    if (identity.source === "npm") {
      return await fetchNpmVulnerabilities(identity.name, identity.version);
    }

    const gh = parseGitHubOwnerRepo(identity.url);
    if (gh) {
      return await fetchGitHubVulnerabilities(
        gh.owner,
        gh.repo,
        identity.version === "latest" ? "HEAD" : identity.version,
      );
    }

    return [];
  } catch (error) {
    // Advisory fetching is best-effort; never fail the audit because OSV is down.
    console.error(
      "Failed to fetch security advisories:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

/**
 * Gather deterministic, verifiable signals for a resolved library.
 *
 * Each signal is fetched independently and failures are swallowed, so a
 * downstream signal being unavailable never aborts the audit.
 */
export async function enrichLibrary(
  identity: LibraryIdentity,
  options: EnrichmentOptions = {},
): Promise<EnrichmentSignals> {
  const [advisories, sourceSignals] = await Promise.all([
    fetchAdvisories(identity),
    identity.source === "npm"
      ? fetchNpmSignals(identity, options)
      : fetchGitHubSignals(identity),
  ]);

  return {
    advisories,
    ...sourceSignals,
  };
}

/**
 * Format signals as a short, prompt-ready summary.
 */
export function formatSignalsForPrompt(signals: EnrichmentSignals): string {
  const parts: string[] = [];

  if (signals.advisories.length > 0) {
    parts.push(
      `Security advisories: ${signals.advisories.length} (${signals.advisories
        .map((a) => `${a.id}:${a.severity ?? "unknown"}`)
        .join(", ")})`,
    );
  } else {
    parts.push("Security advisories: none found");
  }

  if (signals.lastPublished) {
    const days = Math.floor(
      (Date.now() - new Date(signals.lastPublished).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    parts.push(`Last published/pushed: ${days} days ago`);
  }

  if (signals.weeklyDownloads !== undefined) {
    parts.push(`Weekly downloads: ${signals.weeklyDownloads.toLocaleString()}`);
  }

  if (signals.maintainerCount !== undefined) {
    parts.push(`Maintainer count: ${signals.maintainerCount}`);
  }

  if (signals.licenseSpdx) {
    parts.push(`License: ${signals.licenseSpdx}`);
  }

  if (signals.repoStars !== undefined) {
    parts.push(
      `GitHub stars: ${signals.repoStars.toLocaleString()}, forks: ${(signals.repoForks ?? 0).toLocaleString()}, open issues: ${signals.repoOpenIssues ?? 0}`,
    );
  }

  return parts.join("\n");
}
