import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import type { AuditResult } from "@/app/lib/audit";
import type { AuditEvent } from "@/app/lib/run-audit";

const mockRunAudit = vi.fn();

vi.mock("@/app/lib/run-audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/run-audit")>();
  return {
    ...actual,
    runAudit: (...args: unknown[]) => mockRunAudit(...args),
  };
});

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
};

const baseMeta = {
  cached: false,
  auditId: 1,
  reportId: 2,
  codebaseInspected: true,
  interactions: [
    {
      provider: "openai" as const,
      model: "gpt-4o-mini",
      systemPrompt: "system",
      userPrompt: "user",
      request: { model: "gpt-4o-mini" },
      response: { choices: [{ message: { parsed: baseResult } }] },
      startedAt: "2024-01-01T00:00:00.000Z",
      finishedAt: "2024-01-01T00:00:01.000Z",
      tokensInput: 100,
      tokensOutput: 50,
    },
  ],
};

async function readNdjsonStream(response: Response): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  }
  return events;
}

describe("POST /api/audit/stream", () => {
  beforeEach(() => {
    mockRunAudit.mockImplementation(
      async (
        _input: unknown,
        onEvent?: (event: AuditEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({ type: "step", step: "resolve", status: "started" });
        await onEvent?.({
          type: "step",
          step: "resolve",
          status: "completed",
          detail: "lodash",
        });
        await onEvent?.({
          type: "llm",
          phase: "investigate",
          tokensPerSecond: 1234,
          tokensInput: 100,
          tokensOutput: 50,
          elapsedMs: 120,
        });
        await onEvent?.({
          type: "eta",
          estimatedFinishAt: Date.now() + 5000,
        });
        return { result: baseResult, meta: baseMeta };
      },
    );
  });

  afterEach(() => {
    mockRunAudit.mockReset();
  });

  it("streams progress events and a final complete event", async () => {
    const request = new Request("http://localhost/api/audit/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryUrl: "https://www.npmjs.com/package/lodash",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");

    const events = await readNdjsonStream(response);
    expect(events.length).toBeGreaterThan(0);

    const stepEvents = events.filter((e) => (e as { type: string }).type === "step");
    expect(stepEvents.length).toBeGreaterThanOrEqual(2);

    const llmEvent = events.find((e) => (e as { type: string }).type === "llm");
    expect(llmEvent).toMatchObject({
      type: "llm",
      phase: "investigate",
      tokensPerSecond: 1234,
    });

    const completeEvent = events.find(
      (e) => (e as { type: string }).type === "complete",
    );
    expect(completeEvent).toMatchObject({
      type: "complete",
      result: baseResult,
      meta: baseMeta,
    });
  });

  it("returns 400 for missing libraryUrl", async () => {
    const request = new Request("http://localhost/api/audit/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string; code: string };
    expect(data.code).toBe("MISSING_INPUT");
  });

  it("streams an error event when runAudit fails", async () => {
    const { UnsupportedSourceError } = await import("@/app/lib/errors");
    mockRunAudit.mockRejectedValue(new UnsupportedSourceError());

    const request = new Request("http://localhost/api/audit/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryUrl: "https://example.com/package/foo",
      }),
    });

    const response = await POST(request);
    const events = await readNdjsonStream(response);
    const errorEvent = events.find(
      (e) => (e as { type: string }).type === "error",
    );
    expect(errorEvent).toMatchObject({
      type: "error",
      error: {
        code: "UNSUPPORTED_SOURCE",
      },
    });
  });
});
