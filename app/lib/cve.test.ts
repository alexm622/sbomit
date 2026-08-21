import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchNpmVulnerabilities,
  fetchGitHubVulnerabilities,
} from "./cve";
import { UpstreamRateLimitError } from "./errors";

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

const osvResponse = {
  vulns: [
    {
      id: "GHSA-1234-5678-90ab",
      aliases: ["CVE-2021-12345"],
      summary: "Prototype pollution in lodash",
      details: "A detailed description of the vulnerability.",
      severity: [{ type: "CVSS_V3", score: "7.5" }],
      published: "2021-01-01T00:00:00Z",
      modified: "2021-02-01T00:00:00Z",
      references: [{ type: "ADVISORY", url: "https://example.com/advisory" }],
      affected: [
        {
          ranges: [
            {
              type: "GIT",
              events: [{ introduced: "0" }, { fixed: "4.17.21" }],
            },
          ],
        },
      ],
    },
  ],
};

describe("fetchNpmVulnerabilities", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("queries OSV and returns normalized CVEs", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.osv.dev/v1/query",
        response: new Response(JSON.stringify(osvResponse), { status: 200 }),
      },
    ]);

    const cves = await fetchNpmVulnerabilities("lodash", "4.17.20");
    expect(cves).toHaveLength(1);
    expect(cves[0].id).toBe("GHSA-1234-5678-90ab");
    expect(cves[0].aliases).toContain("CVE-2021-12345");
    expect(cves[0].severity).toBe("high");
    expect(cves[0].fixedVersion).toBe("4.17.21");
  });

  it("returns an empty array on OSV error", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.osv.dev/v1/query",
        response: new Response("Server Error", { status: 500 }),
      },
    ]);

    const cves = await fetchNpmVulnerabilities("lodash", "4.17.20");
    expect(cves).toHaveLength(0);
  });

  it("throws UpstreamRateLimitError on OSV 429", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.osv.dev/v1/query",
        response: new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
      },
    ]);

    await expect(
      fetchNpmVulnerabilities("lodash", "4.17.20"),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UpstreamRateLimitError && err.retryAfter === 30,
    );
  });

  it("filters out advisories that do not affect the queried version", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.osv.dev/v1/query",
        response: new Response(
          JSON.stringify({
            vulns: [
              {
                id: "GHSA-old",
                summary: "Old lodash issue",
                affected: [
                  {
                    ranges: [
                      {
                        type: "GIT",
                        events: [{ introduced: "0" }, { fixed: "4.17.21" }],
                      },
                    ],
                  },
                ],
              },
              {
                id: "GHSA-current",
                summary: "Current lodash issue",
                affected: [
                  {
                    ranges: [
                      {
                        type: "GIT",
                        events: [{ introduced: "4.18.0" }, { fixed: "4.18.2" }],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      },
    ]);

    const cves = await fetchNpmVulnerabilities("lodash", "4.18.1");
    expect(cves).toHaveLength(1);
    expect(cves[0].id).toBe("GHSA-current");
  });

  it("keeps advisories with no version range data", async () => {
    globalThis.fetch = mockFetch([
      {
        url: "https://api.osv.dev/v1/query",
        response: new Response(
          JSON.stringify({
            vulns: [
              {
                id: "GHSA-unspecified",
                summary: "Unspecified range",
                affected: [{}],
              },
            ],
          }),
          { status: 200 },
        ),
      },
    ]);

    const cves = await fetchNpmVulnerabilities("lodash", "4.18.1");
    expect(cves).toHaveLength(1);
    expect(cves[0].id).toBe("GHSA-unspecified");
  });
});

describe("fetchGitHubVulnerabilities", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves the ref to a commit and queries OSV", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.github.com")) {
        return new Response(JSON.stringify({ sha: "abc123" }), { status: 200 });
      }
      return new Response(JSON.stringify(osvResponse), { status: 200 });
    });

    const cves = await fetchGitHubVulnerabilities("facebook", "react", "v18.0.0");
    expect(cves).toHaveLength(1);
    expect(cves[0].id).toBe("GHSA-1234-5678-90ab");
  });

  it("returns an empty array when the commit cannot be resolved", async () => {
    globalThis.fetch = mockFetch([
      {
        url: /api\.github\.com/,
        response: new Response("Not Found", { status: 404 }),
      },
    ]);

    const cves = await fetchGitHubVulnerabilities("facebook", "react", "missing");
    expect(cves).toHaveLength(0);
  });
});


