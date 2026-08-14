export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.trim().length === 0) {
    return Response.json({ packages: [] });
  }

  const encoded = encodeURIComponent(query.trim());
  const res = await fetch(
    `https://registry.npmjs.org/-/v1/search?text=${encoded}&size=10`,
    {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 0 },
    },
  );

  if (!res.ok) {
    return Response.json(
      { error: "Failed to fetch packages" },
      { status: res.status },
    );
  }

  const data = (await res.json()) as {
    objects?: Array<{ package?: { name?: string; description?: string } }>;
  };
  const packages = (data.objects || []).map(
    (obj: { package?: { name?: string; description?: string } }) => ({
      name: obj.package?.name || "",
      description: obj.package?.description || "",
    }),
  );

  return Response.json({ packages });
}
