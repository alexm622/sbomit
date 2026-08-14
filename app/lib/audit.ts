import { z } from "zod";

export const auditResultSchema = z.object({
  name: z.string(),
  version: z.string(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  risks: z.array(
    z.object({
      severity: z.enum(["critical", "high", "medium", "low"]),
      title: z.string(),
      description: z.string(),
    }),
  ),
  dependencies: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      license: z.string(),
      transitive: z.boolean(),
    }),
  ),
  license: z.object({
    type: z.string(),
    compatible: z.boolean(),
    note: z.string(),
  }),
  maintainers: z.array(z.string()),
  lastPublished: z.string(),
  weeklyDownloads: z.string(),
});

export type AuditResult = z.infer<typeof auditResultSchema>;

interface NpmMetadata {
  name: string;
  version: string;
  description?: string;
  license?: string | { type?: string };
  author?: { name?: string } | string;
  maintainers?: Array<{ name?: string; email?: string }>;
  time?: Record<string, string>;
  repository?: { url?: string; type?: string };
  homepage?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  dist?: { tarball?: string };
  readme?: string;
  downloads?: Array<{ downloads?: number; day?: string }>;
}

interface GitHubRepo {
  full_name: string;
  description: string | null;
  license: { spdx_id: string | null; name: string | null } | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  owner: { login: string };
  html_url: string;
}

export interface LibraryContext {
  source: "npm" | "github";
  url: string;
  name: string;
  version: string;
  metadata: NpmMetadata | GitHubRepo;
}

export interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  severity?: string;
  aliases?: string[];
}

export interface GitHubSignals {
  releaseCadence?: string;
  daysSinceLastRelease?: number;
  issueSlaDays?: number;
  busFactor?: number;
}

export interface EnrichedContext {
  context: LibraryContext;
  vulnerabilities: OsvVulnerability[];
  githubSignals: GitHubSignals | null;
}

function parseNpmUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/package\/(@[^/]+\/[^/]+|[^/]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
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

export function normalizeLibraryUrl(value: string): string {
  const trimmed = value.trim();
  // Allow bare npm package names, including scoped packages like @types/react.
  if (/^(@[^/]+\/[^/]+|[^/\s:]+)$/.test(trimmed)) {
    return `https://www.npmjs.com/package/${trimmed}`;
  }
  return trimmed;
}

async function fetchNpmMetadata(name: string): Promise<NpmMetadata> {
  const res = await fetch(`https://registry.npmjs.org/${name}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`npm package not found: ${name}`);
    }
    throw new Error(`npm registry error: ${res.status}`);
  }
  return res.json() as Promise<NpmMetadata>;
}

async function fetchGitHubRepo(
  owner: string,
  repo: string,
): Promise<GitHubRepo> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sbomit-audit",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`GitHub repository not found: ${owner}/${repo}`);
    }
    if (res.status === 403) {
      throw new Error(
        `GitHub API rate limit hit. ${token ? "Token may be exhausted." : "Add a GITHUB_TOKEN secret for higher limits."}`,
      );
    }
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json() as Promise<GitHubRepo>;
}

export async function resolveLibrary(
  libraryUrl: string,
): Promise<LibraryContext> {
  const normalized = normalizeLibraryUrl(libraryUrl);
  const npmName = parseNpmUrl(normalized);
  if (npmName) {
    const data = await fetchNpmMetadata(npmName);
    return {
      source: "npm",
      url: normalized,
      name: data.name,
      version: data.version,
      metadata: data,
    };
  }

  const gh = parseGitHubUrl(normalized);
  if (gh) {
    const data = await fetchGitHubRepo(gh.owner, gh.repo);
    return {
      source: "github",
      url: normalized,
      name: data.full_name,
      version: "latest",
      metadata: data,
    };
  }

  throw new Error(
    "Unsupported library URL. Provide an npm package URL, GitHub repository URL, or an npm package name.",
  );
}

export async function fetchOsvVulnerabilities(
  name: string,
  version: string,
): Promise<OsvVulnerability[]> {
  try {
    const res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { name, ecosystem: "npm" },
        version,
      }),
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { vulns?: OsvVulnerability[] };
    return data.vulns || [];
  } catch {
    return [];
  }
}

async function fetchGitHubReleases(
  owner: string,
  repo: string,
): Promise<Array<{ published_at?: string; tag_name?: string }>> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "sbomit-audit",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`,
      { headers, next: { revalidate: 0 } },
    );
    if (!res.ok) return [];
    return res.json() as Promise<Array<{ published_at?: string; tag_name?: string }>>;
  } catch {
    return [];
  }
}

async function fetchGitHubIssuesStats(
  owner: string,
  repo: string,
): Promise<{ avgCloseDays?: number; openCount?: number }> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "sbomit-audit",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=closed&per_page=30&sort=updated`,
      { headers, next: { revalidate: 0 } },
    );
    if (!res.ok) return {};
    const issues = (await res.json()) as Array<{
      created_at?: string;
      closed_at?: string;
    }>;
    const closable = issues.filter((i) => i.created_at && i.closed_at);
    if (closable.length === 0) return {};
    const avgCloseDays =
      closable.reduce((sum, i) => {
        const created = new Date(i.created_at!).getTime();
        const closed = new Date(i.closed_at!).getTime();
        return sum + (closed - created) / (1000 * 60 * 60 * 24);
      }, 0) / closable.length;
    return { avgCloseDays: Math.round(avgCloseDays) };
  } catch {
    return {};
  }
}

async function fetchGitHubContributors(
  owner: string,
  repo: string,
): Promise<number> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "sbomit-audit",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1`,
      { headers, next: { revalidate: 0 } },
    );
    if (!res.ok) return 0;
    const link = res.headers.get("link") || "";
    const match = link.match(/page=(\d+)[^>]*>;\s*rel="last"/);
    if (match) return parseInt(match[1], 10);
    const data = (await res.json()) as unknown[];
    return data.length;
  } catch {
    return 0;
  }
}

export async function enrichLibraryContext(
  context: LibraryContext,
): Promise<EnrichedContext> {
  let vulnerabilities: OsvVulnerability[] = [];
  let githubSignals: GitHubSignals | null = null;

  if (context.source === "npm") {
    vulnerabilities = await fetchOsvVulnerabilities(
      context.name,
      context.version,
    );
  }

  const gh = parseGitHubUrl(context.url);
  if (gh) {
    const [releases, issueStats, contributors] = await Promise.all([
      fetchGitHubReleases(gh.owner, gh.repo),
      fetchGitHubIssuesStats(gh.owner, gh.repo),
      fetchGitHubContributors(gh.owner, gh.repo),
    ]);

    let daysSinceLastRelease: number | undefined;
    let releaseCadence: string | undefined;
    if (releases.length > 1) {
      const first = new Date(releases[0].published_at || Date.now()).getTime();
      const last = new Date(
        releases[releases.length - 1].published_at || Date.now(),
      ).getTime();
      const months = (first - last) / (1000 * 60 * 60 * 24 * 30);
      const count = releases.length - 1;
      releaseCadence = `${(months / count).toFixed(1)} months`;
      daysSinceLastRelease = Math.floor(
        (Date.now() - first) / (1000 * 60 * 60 * 24),
      );
    } else if (releases.length === 1) {
      daysSinceLastRelease = Math.floor(
        (Date.now() - new Date(releases[0].published_at || Date.now()).getTime()) /
          (1000 * 60 * 60 * 24),
      );
    }

    githubSignals = {
      releaseCadence,
      daysSinceLastRelease,
      issueSlaDays: issueStats.avgCloseDays,
      busFactor: contributors,
    };
  }

  return { context, vulnerabilities, githubSignals };
}
