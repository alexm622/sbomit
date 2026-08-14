import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveLibrary,
  postProcessAuditResult,
  computeCacheKey,
  normalizePrompt,
  buildAuditPrompt,
  type LibraryContext,
  type AuditResult,
} from "./audit";
import {
  UnsupportedSourceError,
  PackageNotFoundError,
  RepoNotFoundError,
  UpstreamRateLimitError,
} from "./errors";

const npmMetadata = {
  name: "lodash",
  version: "4.17.21",
  description: "A modern JavaScript utility library.",
  license: "MIT",
  maintainers: [{ name: "jdalton", email: "john.david.dalton@gmail.com" }],
  time: { "4.17.21": "2021-02-20T00:00:00.000Z" },
  dependencies: {},
};

const githubMetadata = {
  full_name: "facebook/react",
  description: "A declarative, efficient, and flexible JavaScript library.",
  license: { spdx_id: "MIT", name: "MIT License" },
  created_at: "2013-05-24T16:15:54Z",
  updated_at: "2024-01-01T00:00:00Z",
  pushed_at: "2024-01-01T00:00:00Z",
  stargazers_count: 220000,
  watchers_count: 220000,
  forks_count: 45000,
  open_issues_count: 1200,
  owner: { login: "facebook" },
  html_url: "https://github.com/facebook/react",
};

function mockFetch(
  responses: Array<{ url: string | RegExp; response: Response }>,
): typeof fetch {
  return vi.fn(async (url: string) => {
    const match = responses.find((r) =>
      typeof r.url === "string" ? url === r.url : r.url.test(url),
    );
    if (!match) {
      return new Response("Not Found", { status: 404 });
    }
    return match.response;
  }) as unknown as typeof fetch;
}

describe("resolveLibrary", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves an npm package URL", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://registry.npmjs.org/lodash",
        response: new Response(JSON.stringify(npmMetadata), { status: 200 }),
      },
    ]);

    const context = await resolveLibrary("https://www.npmjs.com/package/lodash");
    expect(context.source).toBe("npm");
    expect(context.name).toBe("lodash");
    expect(context.version).toBe("4.17.21");
  });

  it("resolves a scoped npm package URL", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://registry.npmjs.org/@types/lodash",
        response: new Response(
          JSON.stringify({ name: "@types/lodash", version: "4.14.0" }),
          { status: 200 },
        ),
      },
    ]);

    const context = await resolveLibrary(
      "https://www.npmjs.com/package/@types/lodash",
    );
    expect(context.source).toBe("npm");
    expect(context.name).toBe("@types/lodash");
  });

  it("throws PackageNotFoundError for npm 404", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://registry.npmjs.org/not-a-real-pkg",
        response: new Response("Not Found", { status: 404 }),
      },
    ]);

    await expect(
      resolveLibrary("https://www.npmjs.com/package/not-a-real-pkg"),
    ).rejects.toBeInstanceOf(PackageNotFoundError);
  });

  it("throws UpstreamRateLimitError for npm 429", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://registry.npmjs.org/lodash",
        response: new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "60" },
        }),
      },
    ]);

    await expect(
      resolveLibrary("https://www.npmjs.com/package/lodash"),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UpstreamRateLimitError && err.retryAfter === 60,
    );
  });

  it("resolves a GitHub repository URL", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.github.com/repos/facebook/react",
        response: new Response(JSON.stringify(githubMetadata), { status: 200 }),
      },
    ]);

    const context = await resolveLibrary("https://github.com/facebook/react");
    expect(context.source).toBe("github");
    expect(context.name).toBe("facebook/react");
    expect(context.version).toBe("latest");
  });

  it("throws RepoNotFoundError for GitHub 404", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.github.com/repos/foo/bar",
        response: new Response("Not Found", { status: 404 }),
      },
    ]);

    await expect(
      resolveLibrary("https://github.com/foo/bar"),
    ).rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it("throws UpstreamRateLimitError for GitHub 403", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.github.com/repos/facebook/react",
        response: new Response("API rate limit exceeded", { status: 403 }),
      },
    ]);

    await expect(
      resolveLibrary("https://github.com/facebook/react"),
    ).rejects.toBeInstanceOf(UpstreamRateLimitError);
  });

  it("throws UnsupportedSourceError for unsupported URLs", async () => {
    await expect(
      resolveLibrary("https://example.com/package/foo"),
    ).rejects.toBeInstanceOf(UnsupportedSourceError);
  });
});

describe("computeCacheKey", () => {
  it("returns a stable SHA-256 hex key", async () => {
    const context: LibraryContext = {
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      name: "lodash",
      version: "4.17.21",
      metadata: npmMetadata,
    };
    const key1 = await computeCacheKey(context, "focus on security");
    const key2 = await computeCacheKey(context, "focus on security");
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different keys for different prompts", async () => {
    const context: LibraryContext = {
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      name: "lodash",
      version: "4.17.21",
      metadata: npmMetadata,
    };
    const key1 = await computeCacheKey(context, "a");
    const key2 = await computeCacheKey(context, "b");
    expect(key1).not.toBe(key2);
  });
});

describe("normalizePrompt", () => {
  it("trims and caps prompts", () => {
    expect(normalizePrompt("  focus  ")).toBe("focus");
    expect(normalizePrompt("   ")).toBeUndefined();
    expect(normalizePrompt("x".repeat(2000))).toHaveLength(1000);
  });
});

describe("buildAuditPrompt", () => {
  it("includes bounded metadata and prompt", () => {
    const context: LibraryContext = {
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      name: "lodash",
      version: "4.17.21",
      metadata: npmMetadata,
    };
    const prompt = buildAuditPrompt(context, "focus");
    expect(prompt).toContain("focus");
    expect(prompt).toContain("lodash");
    expect(prompt).toContain("4.17.21");
    expect(prompt).toContain("Metadata:");
  });

  it("truncates oversized metadata", () => {
    const context: LibraryContext = {
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      name: "lodash",
      version: "4.17.21",
      metadata: { ...npmMetadata, readme: "x".repeat(100_000) },
    };
    const prompt = buildAuditPrompt(context);
    expect(prompt.length).toBeLessThan(12_000);
    expect(prompt).toContain("[truncated]");
  });
});

describe("postProcessAuditResult", () => {
  const context: LibraryContext = {
    source: "npm",
    url: "https://www.npmjs.com/package/lodash",
    name: "lodash",
    version: "4.17.21",
    metadata: npmMetadata,
  };

  const baseResult: AuditResult = {
    name: "lodash",
    version: "4.17.21",
    score: 85.7,
    summary: "Looks good.",
    risks: [],
    investigationAreas: [],
    deepDiveFindings: [],
    dependencies: [],
    license: { type: "MIT", compatible: true, note: "" },
    maintainers: [],
    lastPublished: "recently",
    weeklyDownloads: "many",
  };

  it("clamps score to an integer 0-100", () => {
    const result = postProcessAuditResult(
      { ...baseResult, score: 150.3 },
      context,
    );
    expect(result.score).toBe(100);
  });

  it("deduplicates risks by title", () => {
    const result = postProcessAuditResult(
      {
        ...baseResult,
        risks: [
          { severity: "high", title: "Old dep", description: "a" },
          { severity: "medium", title: "Old dep", description: "b" },
          { severity: "low", title: "Other", description: "c" },
        ],
      },
      context,
    );
    expect(result.risks).toHaveLength(2);
    expect(result.risks[0].severity).toBe("high");
  });

  it("caps risks and dependencies", () => {
    const result = postProcessAuditResult(
      {
        ...baseResult,
        risks: Array.from({ length: 30 }, (_, i) => ({
          severity: "low" as const,
          title: `Risk ${i}`,
          description: "d",
        })),
        dependencies: Array.from({ length: 600 }, (_, i) => ({
          name: `pkg-${i}`,
          version: "1.0.0",
          license: "MIT",
          transitive: false,
        })),
      },
      context,
    );
    expect(result.risks).toHaveLength(20);
    expect(result.dependencies).toHaveLength(500);
  });

  it("falls back to context name/version when empty", () => {
    const result = postProcessAuditResult(
      { ...baseResult, name: "", version: "" },
      context,
    );
    expect(result.name).toBe("lodash");
    expect(result.version).toBe("4.17.21");
  });

  it("caps investigation areas and deep dive findings", () => {
    const result = postProcessAuditResult(
      {
        ...baseResult,
        investigationAreas: Array.from({ length: 15 }, (_, i) => ({
          area: `Area ${i}`,
          rationale: "rationale",
          files: ["file.js"],
        })),
        deepDiveFindings: Array.from({ length: 30 }, (_, i) => ({
          area: "Area",
          file: "file.js",
          issue: `Issue ${i}`,
          evidence: "evidence",
          severity: "low" as const,
        })),
      },
      context,
    );
    expect(result.investigationAreas).toHaveLength(10);
    expect(result.deepDiveFindings).toHaveLength(20);
  });
});
