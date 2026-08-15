import { z } from "zod";
import {
  UnsupportedSourceError,
  PackageNotFoundError,
  RepoNotFoundError,
  UpstreamRateLimitError,
} from "./errors";
import type { CodebaseSnapshot } from "./codebase";
import {
  buildCodebaseSnapshot,
  fetchGitHubTarball,
  fetchNpmTarball,
  formatSnapshotForLlm,
  sourceTokenBudget,
} from "./codebase";
import type { Cve } from "./cve";

const riskSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  title: z.string(),
  description: z.string(),
});

const investigationAreaSchema = z.object({
  area: z.string(),
  rationale: z.string(),
  files: z.array(z.string()),
});

const deepDiveFindingSchema = z.object({
  area: z.string(),
  file: z.string(),
  issue: z.string(),
  evidence: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
});

const cveSchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()),
  severity: z.enum(["critical", "high", "medium", "low"]).nullable(),
  title: z.string(),
  description: z.string(),
  published: z.string().nullable(),
  modified: z.string().nullable(),
  fixedVersion: z.string().nullable(),
  references: z.array(
    z.object({
      type: z.string().nullable(),
      url: z.string(),
    }),
  ),
});

export const auditResultSchema = z.object({
  name: z.string(),
  version: z.string(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  risks: z.array(riskSchema),
  investigationAreas: z.array(investigationAreaSchema),
  deepDiveFindings: z.array(deepDiveFindingSchema),
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
  cves: z.array(cveSchema),
});

export type AuditResult = z.infer<typeof auditResultSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type InvestigationArea = z.infer<typeof investigationAreaSchema>;
export type DeepDiveFinding = z.infer<typeof deepDiveFindingSchema>;

interface NpmMetadata {
  name: string;
  version?: string;
  "dist-tags"?: Record<string, string>;
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
  versions?: Record<string, NpmMetadata>;
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
  codebase?: CodebaseSnapshot;
  cves: Cve[];
}

const MAX_RISKS = 20;
const MAX_DEPENDENCIES = 500;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_METADATA_BYTES = 8192;
const MAX_PROMPT_LENGTH = 1000;
const MAX_INVESTIGATION_AREAS = 10;
const MAX_DEEP_DIVE_FINDINGS = 20;

export interface ParsedNpmInput {
  name: string;
  version?: string;
}

export interface ParsedGitHubInput {
  owner: string;
  repo: string;
  ref?: string;
}

function parseNpmUrl(url: string): ParsedNpmInput | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("npmjs.com")) return null;
    const match = parsed.pathname.match(
      /\/package\/(@[^/]+\/[^/]+|[^/]+)(?:\/v\/)?([^/]+)?/,
    );
    if (match) {
      return {
        name: decodeURIComponent(match[1]),
        version: match[2] ? decodeURIComponent(match[2]) : undefined,
      };
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

function parseNpmPackageName(input: string): ParsedNpmInput | null {
  // Accepts bare package names like "lodash" or "lodash@4.17.20" (scoped packages too).
  // Reject anything that looks like a URL.
  if (input.includes(":") || /\s/.test(input)) return null;
  const match = input.match(/^(@[^/]+\/[^/]+|[^@/]+)(?:@(.+))?$/);
  if (match) {
    return { name: match[1], version: match[2] };
  }
  return null;
}

export function parseGitHubUrl(url: string): ParsedGitHubInput | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("github.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1];
      // Support /tree/<ref> and /blob/<ref> paths.
      if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
        return { owner, repo, ref: parts[3] };
      }
      return { owner, repo };
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  return Number.isNaN(seconds) ? undefined : seconds;
}

function truncateMetadata(metadata: unknown): string {
  let text = JSON.stringify(metadata, null, 2);
  if (text.length > MAX_METADATA_BYTES) {
    text = text.slice(0, MAX_METADATA_BYTES) + "\n... [truncated]";
  }
  return text;
}

export function normalizePrompt(prompt?: string): string | undefined {
  const trimmed = prompt?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_PROMPT_LENGTH);
}

export async function computeCacheKey(
  context: LibraryContext,
  prompt?: string,
): Promise<string> {
  const normalizedPrompt = normalizePrompt(prompt) || "";
  const budget = sourceTokenBudget();
  const input = `${context.source}:${context.name}:${context.version}:${budget}:${normalizedPrompt}`;
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildAuditPrompt(
  context: LibraryContext,
  userPrompt?: string,
): string {
  const prompt = normalizePrompt(userPrompt);
  const resolvedPrompt =
    prompt ||
    "Audit this library for security, license compatibility, and dependency risks. Return a concise, structured report.";

  const cveSection =
    context.cves.length > 0
      ? `\n\nKnown security advisories for ${context.name}@${context.version}:\n${context.cves
          .map(
            (cve) =>
              `- ${cve.id} (${cve.severity ?? "unknown"}): ${cve.title}` +
              (cve.fixedVersion ? ` (fixed in ${cve.fixedVersion})` : ""),
          )
          .join("\n")}`
      : "\n\nNo known security advisories were found for this version.";

  return `${resolvedPrompt}\n\nLibrary URL: ${context.url}\nSource: ${context.source}\nName: ${context.name}\nVersion: ${context.version}${cveSection}\n\nMetadata:\n\`\`\`json\n${truncateMetadata(context.metadata)}\n\`\`\``;
}

export async function resolveLibrary(
  libraryUrl: string,
  requestedVersion?: string,
): Promise<LibraryContext> {
  const npmInput = parseNpmUrl(libraryUrl) ?? parseNpmPackageName(libraryUrl);
  if (npmInput) {
    const version = requestedVersion ?? npmInput.version;
    const res = await fetch(`https://registry.npmjs.org/${npmInput.name}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      if (res.status === 429) {
        throw new UpstreamRateLimitError("npm registry", parseRetryAfter(res));
      }
      throw new PackageNotFoundError(npmInput.name);
    }
    const data = (await res.json()) as NpmMetadata;
    const resolvedVersion =
      version ?? data["dist-tags"]?.latest ?? data.version ?? "latest";
    const versionMetadata = data.versions?.[resolvedVersion] ?? data;
    if (!versionMetadata || !versionMetadata.name) {
      throw new PackageNotFoundError(npmInput.name);
    }
    return {
      source: "npm",
      url: libraryUrl,
      name: data.name,
      version: resolvedVersion,
      metadata: versionMetadata,
      cves: [],
    };
  }

  const gh = parseGitHubUrl(libraryUrl);
  if (gh) {
    const ref = requestedVersion ?? gh.ref;
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
      if (res.status === 429 || res.status === 403) {
        throw new UpstreamRateLimitError("GitHub API", parseRetryAfter(res));
      }
      throw new RepoNotFoundError(gh.owner, gh.repo);
    }
    const data = (await res.json()) as GitHubRepo;
    return {
      source: "github",
      url: libraryUrl,
      name: data.full_name,
      version: ref ?? "latest",
      metadata: data,
      cves: [],
    };
  }

  throw new UnsupportedSourceError();
}

export async function resolveCodebase(
  context: LibraryContext,
): Promise<CodebaseSnapshot | undefined> {
  try {
    if (context.source === "npm") {
      const metadata = context.metadata as NpmMetadata;
      const tarballUrl = metadata.dist?.tarball;
      if (!tarballUrl) {
        console.error("No tarball URL in npm metadata.");
        return undefined;
      }
      const files = await fetchNpmTarball(tarballUrl);
      return buildCodebaseSnapshot(files);
    }

    const gh = parseGitHubUrl(context.url);
    if (gh) {
      const ref = context.version === "latest" ? "HEAD" : context.version;
      const files = await fetchGitHubTarball(gh.owner, gh.repo, ref);
      return buildCodebaseSnapshot(files);
    }

    return undefined;
  } catch (error) {
    // Codebase inspection is best-effort; fall back to metadata-only audit.
    console.error(
      "Failed to resolve codebase:",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

export function buildCodebasePrompt(context: LibraryContext): string {
  if (!context.codebase) return "";
  return formatSnapshotForLlm(context.codebase);
}

export function postProcessAuditResult(
  result: AuditResult,
  context: LibraryContext,
): AuditResult {
  // Clamp list lengths and summary size.
  const risks = result.risks.slice(0, MAX_RISKS);
  const dependencies = result.dependencies.slice(0, MAX_DEPENDENCIES);
  const investigationAreas = result.investigationAreas.slice(
    0,
    MAX_INVESTIGATION_AREAS,
  );
  const deepDiveFindings = result.deepDiveFindings.slice(
    0,
    MAX_DEEP_DIVE_FINDINGS,
  );

  // Deduplicate risks by title (case-insensitive) preserving order.
  const seenTitles = new Set<string>();
  const dedupedRisks = risks.filter((risk) => {
    const key = risk.title.toLowerCase();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  // Override name/version if the model drifted from resolved context.
  const name = result.name || context.name;
  const version = result.version || context.version;

  return {
    ...result,
    name,
    version,
    score: Math.min(100, Math.max(0, Math.round(result.score))),
    summary: result.summary.slice(0, MAX_SUMMARY_LENGTH),
    risks: dedupedRisks,
    investigationAreas,
    deepDiveFindings,
    dependencies,
  };
}
