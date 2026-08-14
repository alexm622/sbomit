import { normalizeLibraryUrl, resolveLibrary } from "./audit";

export interface ResolvedDependency {
  name: string;
  version: string;
  dependency_type: string;
  depth: number;
}

interface NpmPackage {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

async function fetchNpmPackageVersion(
  name: string,
  versionSpec: string,
): Promise<NpmPackage | null> {
  try {
    // Resolve "latest" or range to a concrete version via the registry.
    const resolvedVersion = versionSpec === "latest" ? "latest" : versionSpec;
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(resolvedVersion)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<NpmPackage>;
  } catch {
    return null;
  }
}

export async function resolveTransitiveDependencies(
  libraryUrl: string,
  options: { maxDepth?: number; includeDev?: boolean } = {},
): Promise<ResolvedDependency[]> {
  const { maxDepth = 2, includeDev = false } = options;
  const context = await resolveLibrary(normalizeLibraryUrl(libraryUrl));

  const rootName = context.name;
  const rootVersion = context.version;

  const resolved = new Map<string, ResolvedDependency>();
  const queue: Array<{ name: string; versionSpec: string; depth: number; type: string }> = [];

  if (context.source === "npm") {
    const metadata = context.metadata as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const [name, version] of Object.entries(metadata.dependencies || {})) {
      queue.push({ name, versionSpec: version, depth: 1, type: "dependencies" });
    }
    if (includeDev) {
      for (const [name, version] of Object.entries(metadata.devDependencies || {})) {
        queue.push({ name, versionSpec: version, depth: 1, type: "devDependencies" });
      }
    }
  }

  // Mark root as resolved so we don't recurse back into it.
  resolved.set(`${rootName}@${rootVersion}`, {
    name: rootName,
    version: rootVersion,
    dependency_type: "root",
    depth: 0,
  });

  let index = 0;
  while (index < queue.length) {
    const { name, versionSpec, depth, type } = queue[index++];
    if (depth > maxDepth) continue;

    const pkg = await fetchNpmPackageVersion(name, versionSpec);
    if (!pkg) continue;

    const key = `${pkg.name}@${pkg.version}`;
    if (resolved.has(key)) continue;

    resolved.set(key, {
      name: pkg.name,
      version: pkg.version,
      dependency_type: type,
      depth,
    });

    if (depth < maxDepth) {
      for (const [depName, depVersion] of Object.entries(pkg.dependencies || {})) {
        queue.push({
          name: depName,
          versionSpec: depVersion,
          depth: depth + 1,
          type: "transitive",
        });
      }
    }
  }

  // Remove root entry from returned list.
  resolved.delete(`${rootName}@${rootVersion}`);
  return Array.from(resolved.values());
}
