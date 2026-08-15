import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enrichLibrary, formatSignalsForPrompt } from "./signals";

const mockFetchNpmVulnerabilities = vi.fn();
const mockFetchGitHubVulnerabilities = vi.fn();

vi.mock("./cve", () => ({
  fetchNpmVulnerabilities: (...args: unknown[]) =>
    mockFetchNpmVulnerabilities(...args),
  fetchGitHubVulnerabilities: (...args: unknown[]) =>
    mockFetchGitHubVulnerabilities(...args),
}));

describe("enrichLibrary", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetchNpmVulnerabilities.mockResolvedValue([]);
    mockFetchGitHubVulnerabilities.mockResolvedValue([]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("gathers npm signals from metadata and the downloads API", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ downloads: 1_500_000 }), { status: 200 }),
      ),
    ) as unknown as typeof fetch;

    const signals = await enrichLibrary({
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      name: "lodash",
      version: "4.17.21",
      metadata: {
        time: {
          "4.17.21": "2024-01-01T00:00:00.000Z",
          modified: "2024-02-01T00:00:00.000Z",
        },
        license: "MIT",
        maintainers: [{ name: "jdalton", email: "a@b.com" }],
      },
    });

    expect(signals.advisories).toEqual([]);
    expect(signals.lastPublished).toBe("2024-01-01T00:00:00.000Z");
    expect(signals.licenseSpdx).toBe("MIT");
    expect(signals.maintainerCount).toBe(1);
    expect(signals.weeklyDownloads).toBe(1_500_000);
  });

  it("falls back to modified time when version time is missing", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ downloads: 0 }), { status: 200 })),
    ) as unknown as typeof fetch;

    const signals = await enrichLibrary({
      source: "npm",
      url: "https://www.npmjs.com/package/lodash",
      name: "lodash",
      version: "4.17.21",
      metadata: {
        time: { modified: "2023-06-01T00:00:00.000Z" },
      },
    });

    expect(signals.lastPublished).toBe("2023-06-01T00:00:00.000Z");
  });

  it("gathers GitHub signals from metadata", async () => {
    const signals = await enrichLibrary({
      source: "github",
      url: "https://github.com/facebook/react",
      name: "facebook/react",
      version: "latest",
      metadata: {
        pushed_at: "2024-01-01T00:00:00.000Z",
        stargazers_count: 220_000,
        forks_count: 45_000,
        open_issues_count: 1_200,
        license: { spdx_id: "MIT" },
      },
    });

    expect(signals.repoStars).toBe(220_000);
    expect(signals.repoForks).toBe(45_000);
    expect(signals.repoOpenIssues).toBe(1_200);
    expect(signals.licenseSpdx).toBe("MIT");
    expect(signals.maintainerCount).toBe(1);
  });

  it("includes security advisories from the CVE layer", async () => {
    mockFetchNpmVulnerabilities.mockResolvedValue([
      {
        id: "GHSA-xxx",
        aliases: ["CVE-2024-0001"],
        severity: "high" as const,
        title: "Bad bug",
        description: "desc",
        published: null,
        modified: null,
        fixedVersion: "1.0.1",
        references: [],
      },
    ]);

    const signals = await enrichLibrary({
      source: "npm",
      url: "https://www.npmjs.com/package/pkg",
      name: "pkg",
      version: "1.0.0",
      metadata: {},
    });

    expect(signals.advisories).toHaveLength(1);
    expect(signals.advisories[0].id).toBe("GHSA-xxx");
  });

  it("does not fail when the downloads API is unavailable", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("error", { status: 500 })),
    ) as unknown as typeof fetch;

    const signals = await enrichLibrary({
      source: "npm",
      url: "https://www.npmjs.com/package/pkg",
      name: "pkg",
      version: "1.0.0",
      metadata: { time: { modified: "2024-01-01T00:00:00.000Z" } },
    });

    expect(signals.weeklyDownloads).toBeUndefined();
    expect(signals.lastPublished).toBeDefined();
  });
});

describe("formatSignalsForPrompt", () => {
  it("renders a concise signal summary", () => {
    const text = formatSignalsForPrompt({
      advisories: [
        {
          id: "GHSA-xxx",
          aliases: [],
          severity: "high" as const,
          title: "Bad bug",
          description: "",
          published: null,
          modified: null,
          fixedVersion: null,
          references: [],
        },
      ],
      lastPublished: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      weeklyDownloads: 1_000_000,
      maintainerCount: 1,
      licenseSpdx: "MIT",
    });

    expect(text).toContain("Security advisories: 1");
    expect(text).toContain("GHSA-xxx:high");
    expect(text).toContain("Weekly downloads: 1,000,000");
    expect(text).toContain("Maintainer count: 1");
    expect(text).toContain("License: MIT");
  });
});
