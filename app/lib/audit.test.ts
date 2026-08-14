import { describe, it, expect } from "vitest";
import {
  normalizeLibraryUrl,
  auditResultSchema,
  type AuditResult,
} from "./audit";

describe("normalizeLibraryUrl", () => {
  it("turns a bare npm package name into an npm URL", () => {
    expect(normalizeLibraryUrl("lodash")).toBe(
      "https://www.npmjs.com/package/lodash",
    );
  });

  it("preserves a full npm URL", () => {
    expect(normalizeLibraryUrl("https://www.npmjs.com/package/lodash")).toBe(
      "https://www.npmjs.com/package/lodash",
    );
  });

  it("preserves a GitHub URL", () => {
    expect(normalizeLibraryUrl("https://github.com/facebook/react")).toBe(
      "https://github.com/facebook/react",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeLibraryUrl("  lodash  ")).toBe(
      "https://www.npmjs.com/package/lodash",
    );
  });

  it("handles scoped packages", () => {
    expect(normalizeLibraryUrl("@types/react")).toBe(
      "https://www.npmjs.com/package/@types/react",
    );
  });
});

describe("auditResultSchema", () => {
  const validResult: AuditResult = {
    name: "lodash",
    version: "4.17.21",
    score: 85,
    summary: "A popular utility library.",
    risks: [
      {
        severity: "low",
        title: "Large maintainer surface",
        description: "Many collaborators.",
      },
    ],
    dependencies: [
      { name: "foo", version: "1.0.0", license: "MIT", transitive: false },
    ],
    license: { type: "MIT", compatible: true, note: "Permissive license." },
    maintainers: ["jdalton"],
    lastPublished: "2021-02-01",
    weeklyDownloads: "50M",
  };

  it("accepts a valid audit result", () => {
    expect(() => auditResultSchema.parse(validResult)).not.toThrow();
  });

  it("rejects a score outside 0-100", () => {
    expect(() =>
      auditResultSchema.parse({ ...validResult, score: 101 }),
    ).toThrow();
  });

  it("rejects an invalid severity", () => {
    expect(() =>
      auditResultSchema.parse({
        ...validResult,
        risks: [{ severity: "extreme", title: "x", description: "y" }],
      }),
    ).toThrow();
  });

  it("rejects a missing required field", () => {
    const rest = { ...validResult };
    delete (rest as Partial<typeof rest>).summary;
    expect(() => auditResultSchema.parse(rest)).toThrow();
  });
});
