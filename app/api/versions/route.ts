interface NpmMetadata {
  versions?: Record<string, unknown>;
  "dist-tags"?: Record<string, string>;
}

function looksLikePackageName(value: string): boolean {
  return /^[^/\s:]+$/.test(value.trim());
}

function extractPackageName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare package name like "lodash" or "lodash@1.2.3".
  if (looksLikePackageName(trimmed)) {
    const match = trimmed.match(/^(@[^/]+\/[^@/]+|[^@/]+)(?:@.+)?$/);
    return match?.[1] ?? null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname.endsWith("npmjs.com")) return null;
    const match = parsed.pathname.match(
      /\/package\/(@[^/]+\/[^/]+|[^/]+)(?:\/v\/[^/]+)?\/?$/,
    );
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((part) => {
    const match = /^\d+/.exec(part);
    return match ? Number.parseInt(match[0], 10) : 0;
  });
  const partsB = b.split(".").map((part) => {
    const match = /^\d+/.exec(part);
    return match ? Number.parseInt(match[0], 10) : 0;
  });

  const max = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < max; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numB - numA;
  }
  return b.localeCompare(a);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const input = searchParams.get("q");

  const packageName = input ? extractPackageName(input) : null;
  if (!packageName) {
    return Response.json({ versions: [], latest: null }, { status: 400 });
  }

  const res = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      next: { revalidate: 0 },
    },
  );

  if (!res.ok) {
    return Response.json(
      { versions: [], latest: null, error: "Failed to fetch versions" },
      { status: res.status },
    );
  }

  const data = (await res.json()) as NpmMetadata;
  const versions = Object.keys(data.versions ?? {}).sort(compareVersions);
  const latest = data["dist-tags"]?.latest ?? null;

  return Response.json({ versions, latest });
}
