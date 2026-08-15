import { describe, it, expect } from "vitest";
import { computeScore, dependencyHealthScore, maintenanceScore } from "./score";
import type { AuditResult, LibraryContext } from "./audit";

const npmMetadata = {
  name: "lodash",
  "dist-tags": { latest: "4.17.21" },
  time: {
    created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    modified: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    "4.17.21": new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
};

const baseResult: AuditResult = {
  name: "lodash",
  version: "4.17.21",
  score: 85,
  summary: "Looks good.",
  risks: [],
  investigationAreas: [],
  deepDiveFindings: [],
  dependencies: [],
  license: { type: "MIT", compatible: true, note: "" },
  maintainers: [],
  lastPublished: "recently",
  weeklyDownloads: "many",
  cves: [],
};

const baseContext: LibraryContext = {
  source: "npm",
  url: "https://www.npmjs.com/package/lodash",
  name: "lodash",
  version: "4.17.21",
  metadata: npmMetadata,
  cves: [],
};

describe("computeScore", () => {
  it("scores a healthy package with source inspection at 100", () => {
    const result = computeScore(
      baseResult,
      {
        ...baseContext,
        codebase: {
          files: [{ path: "index.js", size: 100, content: "" }],
          fileCount: 1,
          totalSize: 100,
        },
      },
      undefined,
    );
    expect(result).toBe(100);
  });

  it("scores a healthy metadata-only package at 80", () => {
    const result = computeScore(baseResult, baseContext);
    expect(result).toBe(80);
  });

  it("penalizes CVEs and evidence-backed findings", () => {
    const result = computeScore(
      {
        ...baseResult,
        cves: [
          {
            id: "CVE-1",
            aliases: [],
            severity: "high" as const,
            title: "Bad bug",
            description: "desc",
            published: null,
            modified: null,
            fixedVersion: "1.0.1",
            references: [],
          },
        ],
        deepDiveFindings: [
          {
            area: "Network",
            file: "index.js",
            issue: "Unexpected fetch",
            evidence: "fetch(url)",
            severity: "medium" as const,
          },
        ],
      },
      baseContext,
    );
    expect(result).toBeLessThan(80);
  });

  it("penalizes incompatible licenses", () => {
    const result = computeScore(
      {
        ...baseResult,
        license: { type: "GPL-3.0", compatible: false, note: "" },
      },
      baseContext,
    );
    expect(result).toBe(70);
  });

  it("uses enrichment signals when provided", () => {
    const result = computeScore(baseResult, baseContext, {
      advisories: [],
      maintainerCount: 1,
      weeklyDownloads: 500,
    });
    // 80 - 2 (single maintainer) - 2 (low downloads) = 76
    expect(result).toBe(76);
  });
});

describe("maintenanceScore", () => {
  it("gives full credit for recent packages", () => {
    expect(
      maintenanceScore(baseResult, baseContext, {
        advisories: [],
        lastPublished: new Date().toISOString(),
      }),
    ).toBe(10);
  });

  it("reduces credit for stale packages", () => {
    const stale = new Date(
      Date.now() - 500 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(
      maintenanceScore(baseResult, baseContext, {
        advisories: [],
        lastPublished: stale,
      }),
    ).toBe(7);
  });
});

describe("dependencyHealthScore", () => {
  it("rewards zero dependencies", () => {
    expect(dependencyHealthScore(baseResult)).toBe(10);
  });

  it("penalizes many direct dependencies", () => {
    const result: AuditResult = {
      ...baseResult,
      dependencies: Array.from({ length: 20 }, () => ({
        name: "pkg",
        version: "1.0.0",
        license: "MIT",
        transitive: false,
      })),
    };
    expect(dependencyHealthScore(result)).toBe(2);
  });
});
