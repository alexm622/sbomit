import { describe, it, expect, vi } from "vitest";
import { resolveTransitiveDependencies } from "./dependencies";

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (url: string) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify(responses[key]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("resolveTransitiveDependencies", () => {
  it("returns direct dependencies by default", async () => {
    global.fetch = mockFetch({
      "registry.npmjs.org/root": {
        name: "root",
        version: "1.0.0",
        dependencies: { "dep-a": "^1.0.0" },
      },
      "registry.npmjs.org/dep-a/": {
        name: "dep-a",
        version: "1.0.0",
        dependencies: { "dep-b": "^1.0.0" },
      },
    }) as typeof fetch;

    const deps = await resolveTransitiveDependencies(
      "https://www.npmjs.com/package/root",
      { maxDepth: 1 },
    );

    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      name: "dep-a",
      version: "1.0.0",
      depth: 1,
    });
  });

  it("walks transitive dependencies up to maxDepth", async () => {
    global.fetch = mockFetch({
      "registry.npmjs.org/root": {
        name: "root",
        version: "1.0.0",
        dependencies: { "dep-a": "^1.0.0" },
      },
      "registry.npmjs.org/dep-a/": {
        name: "dep-a",
        version: "1.0.0",
        dependencies: { "dep-b": "^1.0.0" },
      },
      "registry.npmjs.org/dep-b/": {
        name: "dep-b",
        version: "1.0.0",
        dependencies: { "dep-c": "^1.0.0" },
      },
      "registry.npmjs.org/dep-c/": {
        name: "dep-c",
        version: "1.0.0",
      },
    }) as typeof fetch;

    const deps = await resolveTransitiveDependencies(
      "https://www.npmjs.com/package/root",
      { maxDepth: 2 },
    );

    const names = deps.map((d) => d.name).sort();
    expect(names).toEqual(["dep-a", "dep-b"]);
  });

  it("deduplicates already resolved packages", async () => {
    global.fetch = mockFetch({
      "registry.npmjs.org/root": {
        name: "root",
        version: "1.0.0",
        dependencies: { "dep-a": "^1.0.0", "dep-b": "^1.0.0" },
      },
      "registry.npmjs.org/dep-a/": {
        name: "shared",
        version: "1.0.0",
      },
      "registry.npmjs.org/dep-b/": {
        name: "shared",
        version: "1.0.0",
      },
    }) as typeof fetch;

    const deps = await resolveTransitiveDependencies(
      "https://www.npmjs.com/package/root",
      { maxDepth: 1 },
    );

    expect(deps).toHaveLength(1);
  });
});
