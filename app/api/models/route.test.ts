import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

function mockFetch(response: Response | (() => Response)) {
  return vi.fn(async () =>
    typeof response === "function" ? response() : response,
  );
}

describe("POST /api/models", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns OpenAI models", async () => {
    globalThis.fetch = mockFetch(
      new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
        }),
        { status: 200 },
      ),
    );

    const request = new Request("http://localhost/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", apiKey: "sk-test" }),
    });

    const response = await POST(request);
    const data = (await response.json()) as { models: string[] };

    expect(response.status).toBe(200);
    expect(data.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("uses a custom base URL for OpenAI-compatible endpoints", async () => {
    globalThis.fetch = mockFetch(
      new Response(
        JSON.stringify({
          data: [{ id: "meta-llama/llama-3.1-70b-instruct" }],
        }),
        { status: 200 },
      ),
    );

    const request = new Request("http://localhost/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        apiKey: "sk-test",
        baseUrl: "https://openrouter.ai/api/v1/",
      }),
    });

    const response = await POST(request);
    const data = (await response.json()) as { models: string[] };

    expect(response.status).toBe(200);
    expect(data.models).toEqual(["meta-llama/llama-3.1-70b-instruct"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.anything(),
    );
  });

  it("returns Anthropic models", async () => {
    globalThis.fetch = mockFetch(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-3-5-sonnet-20241022" }],
        }),
        { status: 200 },
      ),
    );

    const request = new Request("http://localhost/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant" }),
    });

    const response = await POST(request);
    const data = (await response.json()) as { models: string[] };

    expect(response.status).toBe(200);
    expect(data.models).toEqual(["claude-3-5-sonnet-20241022"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=1000",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "sk-ant",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });

  it("returns Google Gemini models", async () => {
    globalThis.fetch = mockFetch(
      new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-1.5-flash-latest" }],
        }),
        { status: 200 },
      ),
    );

    const request = new Request("http://localhost/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", apiKey: "gemini-test" }),
    });

    const response = await POST(request);
    const data = (await response.json()) as { models: string[] };

    expect(response.status).toBe(200);
    expect(data.models).toEqual(["gemini-1.5-flash-latest"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=gemini-test",
    );
  });

  it("returns 400 for missing provider", async () => {
    const request = new Request("http://localhost/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for missing Anthropic API key", async () => {
    const request = new Request("http://localhost/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "anthropic" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 502 for an upstream error", async () => {
    globalThis.fetch = mockFetch(
      new Response("Internal server error", { status: 500 }),
    );

    const request = new Request("http://localhost/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", apiKey: "sk-test" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
