export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as { error?: string } | undefined;
  if (!res.ok || data?.error) {
    throw new ApiError(data?.error ?? `Request failed: ${res.status}`, res.status);
  }
  return data as T;
}

export async function apiFetchJson<T>(
  url: string,
  body: unknown,
  init: Omit<RequestInit, "body"> = {},
): Promise<T> {
  return apiFetch<T>(url, {
    ...init,
    method: init.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: JSON.stringify(body),
  });
}
