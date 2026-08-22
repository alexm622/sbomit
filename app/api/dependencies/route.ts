import { resolveLibrary, type LibraryContext } from "@/app/lib/audit";
import {
  getDb,
  saveDependencyTree,
  type StoredDependency,
} from "@/app/lib/db";
import { requireAuth } from "@/app/lib/auth";
import { parseJsonBody, withErrorHandling } from "@/app/lib/api";

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

  return deps;
}

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request);

  const libraryUrl =
    body && typeof body === "object"
      ? (body as { libraryUrl?: unknown }).libraryUrl
      : undefined;

  if (typeof libraryUrl !== "string" || libraryUrl.trim().length === 0) {
    return Response.json(
      { error: "libraryUrl is required." },
      { status: 400 },
    );
  }

  const db = await getDb();
  const user = await requireAuth(db, request);
  const context = await resolveLibrary(libraryUrl.trim());
  const dependencies = extractDependencies(context);

  const auditId = await saveDependencyTree(
    db,
    {
      name: context.name,
      version: context.version,
      source: context.source,
      url: context.url,
      userId: user.id,
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
});
