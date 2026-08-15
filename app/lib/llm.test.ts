import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLlmConfig, runLibraryAudit } from "./llm";
import { AuditParseError, UpstreamRateLimitError } from "./errors";
import type { LibraryContext, AuditResult } from "./audit";

const mockParse = vi.fn();

const { MockOpenAI, MockAPIError } = vi.hoisted(() => {
  class MockAPIError extends Error {
    status?: number;
    headers?: Headers;
    constructor(status: number, message: string, headers?: Headers) {
      super(message);
      this.status = status;
      this.headers = headers;
    }
  }

  class MockOpenAI {
    static APIError = MockAPIError;
    chat = {
      completions: {
        parse: (...args: unknown[]) => mockParse(...args),
      },
    };
  }

  return { MockOpenAI, MockAPIError };
});

vi.mock("openai", () => {
  return {
    default: MockOpenAI,
    APIError: MockAPIError,
  };
});

const context: LibraryContext = {
  source: "npm",
  url: "https://www.npmjs.com/package/lodash",
  name: "lodash",
  version: "4.17.21",
  metadata: {
    name: "lodash",
    version: "4.17.21",
    license: "MIT",
  },
  cves: [],
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

describe("runLibraryAudit", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockParse.mockReset();
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.LLM_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  it("returns parsed and post-processed result with OpenAI", async () => {
    mockParse.mockResolvedValue({
      choices: [
        {
          message: {
            parsed: { ...baseResult, score: 85.7 },
          },
        },
      ],
    });

    const { result, interactions } = await runLibraryAudit(context);
    expect(result.score).toBe(86);
    expect(result.name).toBe("lodash");
    expect(interactions).toHaveLength(1);
    expect(interactions[0].provider).toBe("openai");
    expect(interactions[0].model).toBe("gpt-4o-mini");
    expect(interactions[0].systemPrompt).toBeDefined();
    expect(interactions[0].userPrompt).toContain("lodash");
    expect(mockParse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ]),
      }),
    );
  });

  it("runs a two-phase audit when a codebase snapshot is provided", async () => {
    const contextWithCodebase = {
      ...context,
      codebase: {
        fileCount: 1,
        totalSize: 100,
        files: [{ path: "package.json", size: 100, content: '{"name":"x"}' }],
      },
    };

    mockParse
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              parsed: {
                investigationAreas: [
                  {
                    area: "Package manifest",
                    rationale: "Check for risky scripts.",
                    files: ["package.json"],
                  },
                ],
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              parsed: { ...baseResult, score: 88.5 },
            },
          },
        ],
      });

    const { result, interactions } = await runLibraryAudit(
      contextWithCodebase,
    );
    expect(result.score).toBe(89);
    expect(interactions).toHaveLength(2);
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  it("uses a lite snapshot for investigation when the codebase exceeds the token budget", async () => {
    const hugeContent = "x".repeat(1_000_000);
    const contextWithHugeCodebase = {
      ...context,
      codebase: {
        fileCount: 2,
        totalSize: hugeContent.length + 50,
        files: [
          { path: "package.json", size: 50, content: '{"name":"x"}' },
          { path: "src/huge.js", size: hugeContent.length, content: hugeContent },
        ],
      },
    };

    mockParse
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              parsed: {
                investigationAreas: [
                  {
                    area: "Huge file",
                    rationale: "Check for obfuscation.",
                    files: ["src/huge.js"],
                  },
                ],
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              parsed: { ...baseResult, score: 88.5 },
            },
          },
        ],
      });

    await runLibraryAudit(contextWithHugeCodebase);
    const investigationCall = mockParse.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = investigationCall.messages.find(
      (m) => m.role === "user",
    )?.content;
    expect(userPrompt).toContain("FILE_LISTING.txt");
    expect(userPrompt?.length).toBeLessThan(hugeContent.length);
  });

  it("throws AuditParseError when parsed is missing", async () => {
    mockParse.mockResolvedValue({
      choices: [{ message: {} }],
    });

    await expect(runLibraryAudit(context)).rejects.toBeInstanceOf(
      AuditParseError,
    );
  });

  it("throws UpstreamRateLimitError on OpenAI 429", async () => {
    mockParse.mockImplementation(() => {
      throw new MockAPIError(
        429,
        "Rate limit exceeded",
        new Headers({ "retry-after": "30" }),
      );
    });

    await expect(runLibraryAudit(context)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UpstreamRateLimitError && err.retryAfter === 30,
    );
  });

  it("throws AuditParseError on other OpenAI errors", async () => {
    mockParse.mockImplementation(() => {
      throw new MockAPIError(500, "Internal server error");
    });

    await expect(runLibraryAudit(context)).rejects.toBeInstanceOf(
      AuditParseError,
    );
  });

  it("calls an OpenAI-compatible base URL when configured", async () => {
    process.env.LLM_BASE_URL = "https://api.example.com/v1";
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: baseResult } }],
    });

    await runLibraryAudit(context);
    expect(mockParse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  it("calls Anthropic and parses a tool_use result", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-test";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "audit_result",
              input: { ...baseResult, score: 92.3 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const { result, interactions } = await runLibraryAudit(context);
    expect(result.score).toBe(92);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].provider).toBe("anthropic");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "anthropic-test",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });

  it("throws UpstreamRateLimitError on Anthropic 429", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-test";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Rate limited", {
        status: 429,
        headers: new Headers({ "retry-after": "45" }),
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(runLibraryAudit(context)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UpstreamRateLimitError && err.retryAfter === 45,
    );
  });

  it("calls Gemini and parses JSON response", async () => {
    process.env.LLM_PROVIDER = "google";
    process.env.GEMINI_API_KEY = "gemini-test";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ ...baseResult, score: 78.2 }) }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const { result, interactions } = await runLibraryAudit(context);
    expect(result.score).toBe(78);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].provider).toBe("google");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws UpstreamRateLimitError on Gemini 429", async () => {
    process.env.LLM_PROVIDER = "google";
    process.env.GEMINI_API_KEY = "gemini-test";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Rate limited", {
        status: 429,
        headers: new Headers({ "retry-after": "60" }),
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(runLibraryAudit(context)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UpstreamRateLimitError && err.retryAfter === 60,
    );
  });

  it("throws AuditParseError for generic errors", async () => {
    mockParse.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(runLibraryAudit(context)).rejects.toBeInstanceOf(
      AuditParseError,
    );
  });
});

describe("getLlmConfig", () => {
  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
  });

  it("defaults to OpenAI with gpt-4o-mini", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const config = getLlmConfig();
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o-mini");
  });

  it("uses explicit provider and model", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "key";
    process.env.LLM_MODEL = "claude-opus";
    const config = getLlmConfig();
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-opus");
  });

  it("allows a keyless OpenAI-compatible endpoint when a base URL is set", () => {
    process.env.LLM_BASE_URL = "http://10.100.0.34:10000/api/v1";
    const config = getLlmConfig();
    expect(config.provider).toBe("openai");
    expect(config.apiKey).toBe("unused");
    expect(config.baseUrl).toBe("http://10.100.0.34:10000/api/v1");
  });

  it("throws when no key and no base URL are configured for OpenAI", () => {
    expect(() => getLlmConfig()).toThrow(AuditParseError);
  });

  it("throws when the provider is unsupported", () => {
    process.env.LLM_PROVIDER = "unknown";
    process.env.LLM_API_KEY = "key";
    expect(() => getLlmConfig()).toThrow(AuditParseError);
  });
});
