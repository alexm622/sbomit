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
  dist?: { tarball?: string };
  readme?: string;
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

export async function resolveLibrary(
  libraryUrl: string,
): Promise<LibraryContext> {
  const npmName = parseNpmUrl(libraryUrl);
  if (npmName) {
    const res = await fetch(`https://registry.npmjs.org/${npmName}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      throw new Error(`npm package not found: ${npmName}`);
    }
    const data = (await res.json()) as NpmMetadata;
    return {
      source: "npm",
      url: libraryUrl,
      name: data.name,
      version: data.version,
      metadata: data,
    };
  }

  const gh = parseGitHubUrl(libraryUrl);
  if (gh) {
    const res = await fetch(
      `https://api.github.com/repos/${gh.owner}/${gh.repo}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "sbomit-audit",
        },
        next: { revalidate: 0 },
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub repository not found: ${gh.owner}/${gh.repo}`);
    }
    const data = (await res.json()) as GitHubRepo;
    return {
      source: "github",
      url: libraryUrl,
      name: data.full_name,
      version: "latest",
      metadata: data,
    };
  }

  throw new Error(
    "Unsupported library URL. Provide an npm package URL or GitHub repository URL.",
  );
}
