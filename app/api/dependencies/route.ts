import { resolveLibrary, type LibraryContext } from "@/app/lib/audit";
import {
  getDb,
  saveDependencyTree,
  type StoredDependency,
} from "@/app/lib/db";

interface DependencyTreeResponse {
  auditId: number;
  name: string;
  version: string;
  source: string;
  url: string;
  dependencies: StoredDependency[];
}

function extractDependencies(
  context: LibraryContext,
): StoredDependency[] {
  const deps: StoredDependency[] = [];

  if (context.source === "npm") {
    const metadata = context.metadata as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    for (const [name, version] of Object.entries(metadata.dependencies || {})) {
      deps.push({ name, version, dependency_type: "dependencies" });
    }
    for (const [name, version] of Object.entries(
      metadata.devDependencies || {},
    )) {
      deps.push({ name, version, dependency_type: "devDependencies" });
    }
    for (const [name, version] of Object.entries(
      metadata.peerDependencies || {},
    )) {
      deps.push({ name, version, dependency_type: "peerDependencies" });
    }
    for (const [name, version] of Object.entries(
      metadata.optionalDependencies || {},
    )) {
      deps.push({ name, version, dependency_type: "optionalDependencies" });
    }
  }

  // GitHub repos don't publish dependency manifests via the basic repo API,
  // so we store an empty direct-dependency list for that source.

  return deps;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { libraryUrl?: string };
    const libraryUrl = body.libraryUrl?.trim();

    if (!libraryUrl) {
      return Response.json(
        { error: "libraryUrl is required." },
        { status: 400 },
      );
    }

    const db = await getDb();
    const context = await resolveLibrary(libraryUrl);
    const dependencies = extractDependencies(context);

    const auditId = await saveDependencyTree(
      db,
      {
        name: context.name,
        version: context.version,
        source: context.source,
        url: context.url,
      },
      dependencies,
    );

    const response: DependencyTreeResponse = {
      auditId,
      name: context.name,
      version: context.version,
      source: context.source,
      url: context.url,
      dependencies,
    };

    return Response.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return Response.json({ error: message }, { status: 500 });
  }
}
