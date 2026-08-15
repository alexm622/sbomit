import { describe, it, expect, vi } from "vitest";
import {
  parseTar,
  buildCodebaseSnapshot,
  formatSnapshotForLlm,
  shouldSkipFile,
  estimateTokens,
  buildLiteSnapshot,
  buildBudgetedSnapshot,
  chunkSnapshot,
  MAX_FILE_SIZE,
  MAX_TARBALL_BYTES,
} from "./codebase";

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function checksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 148; i++) sum += header[i];
  // checksum field itself is treated as spaces.
  for (let i = 0; i < 8; i++) sum += 0x20;
  for (let i = 156; i < 512; i++) sum += header[i];
  return sum;
}

function createTarEntry(name: string, content: string): Uint8Array {
  const contentBytes = new TextEncoder().encode(content);
  const size = contentBytes.length;

  const header = new Uint8Array(512);
  const nameBytes = new TextEncoder().encode(name);
  header.set(nameBytes.slice(0, 100), 0);

  const mode = new TextEncoder().encode(octal(0o644, 8));
  header.set(mode, 100);

  const uid = new TextEncoder().encode(octal(1000, 8));
  header.set(uid, 108);

  const gid = new TextEncoder().encode(octal(1000, 8));
  header.set(gid, 116);

  const sizeBytes = new TextEncoder().encode(octal(size, 12));
  header.set(sizeBytes, 124);

  const mtime = new TextEncoder().encode(octal(0, 12));
  header.set(mtime, 136);

  const checksumVal = checksum(header);
  const checksumBytes = new TextEncoder().encode(
    checksumVal.toString(8).padStart(6, "0") + "\0 ",
  );
  header.set(checksumBytes, 148);

  header[156] = 0x30; // regular file

  const padding = new Uint8Array((512 - (size % 512)) % 512);
  const result = new Uint8Array(512 + size + padding.length);
  result.set(header, 0);
  result.set(contentBytes, 512);
  result.set(padding, 512 + size);
  return result;
}

function createTar(entries: { name: string; content: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    parts.push(createTarEntry(entry.name, entry.content));
  }
  // Two zero blocks at end.
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

describe("parseTar", () => {
  it("extracts regular text files and strips root prefix", () => {
    const tar = createTar([
      { name: "package/package.json", content: '{"name":"test"}' },
      { name: "package/index.js", content: "console.log('hi');" },
    ]);

    const files = parseTar(tar);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path)).toContain("package.json");
    expect(files.map((f) => f.path)).toContain("index.js");
  });

  it("skips binary and ignored directories", () => {
    const tar = createTar([
      { name: "package/node_modules/foo.js", content: "bad" },
      { name: "package/logo.png", content: "PNG\0\0" },
      { name: "package/src/index.js", content: "ok" },
    ]);

    const files = parseTar(tar);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/index.js");
  });

  it("limits oversized files", () => {
    const tar = createTar([
      { name: "package/huge.js", content: "x".repeat(MAX_FILE_SIZE + 1) },
    ]);

    const files = parseTar(tar);
    expect(files).toHaveLength(0);
  });

  it("handles pax extended headers with long paths", () => {
    const longPath =
      "package/very/long/path/that/exceeds/the/classic/tar/name/limit/file.js";
    const paxContent = `30 path=${longPath}\n`;
    const paxEntry = createTarEntry("pax_header", paxContent);
    // Set pax type flag ('x') in the header.
    paxEntry[156] = 0x78;

    const fileEntry = createTarEntry("", "console.log('ok');");

    const tar = new Uint8Array(
      paxEntry.length + fileEntry.length + 1024,
    );
    tar.set(paxEntry, 0);
    tar.set(fileEntry, paxEntry.length);

    const files = parseTar(tar);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(
      "very/long/path/that/exceeds/the/classic/tar/name/limit/file.js",
    );
  });
});

describe("buildCodebaseSnapshot", () => {
  it("prioritizes package.json and caps total size", () => {
    const files = [
      { path: "src/a.js", size: 100, content: "a".repeat(100) },
      { path: "package.json", size: 50, content: '{"name":"x"}' },
    ];
    const snapshot = buildCodebaseSnapshot(files);
    expect(snapshot.files[0].path).toBe("package.json");
  });
});

describe("formatSnapshotForLlm", () => {
  it("includes file paths and contents", () => {
    const snapshot = buildCodebaseSnapshot([
      { path: "package.json", size: 10, content: '{"name":"x"}' },
    ]);
    const text = formatSnapshotForLlm(snapshot);
    expect(text).toContain("package.json");
    expect(text).toContain('"name":"x"');
  });
});

describe("shouldSkipFile", () => {
  it("is exported for direct use", () => {
    expect(shouldSkipFile("node_modules/foo.js")).toBe(true);
    expect(shouldSkipFile("src/index.js")).toBe(false);
  });
});

describe("estimateTokens", () => {
  it("returns a conservative character-based estimate", () => {
    expect(estimateTokens("x".repeat(300))).toBe(100);
  });
});

describe("buildLiteSnapshot", () => {
  it("includes priority files, samples, and a full file listing", () => {
    const snapshot = buildCodebaseSnapshot([
      { path: "package.json", size: 50, content: '{"name":"x"}' },
      { path: "src/index.js", size: 100, content: "console.log('ok');" },
      { path: "src/helpers.js", size: 100, content: "export const x = 1;" },
      { path: "dist/bundle.js", size: 200, content: "minified" },
    ]);
    const lite = buildLiteSnapshot(snapshot);
    const paths = lite.files.map((f) => f.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("FILE_LISTING.txt");
    expect(lite.files.find((f) => f.path === "FILE_LISTING.txt")?.content).toContain(
      "src/index.js",
    );
  });
});

describe("buildBudgetedSnapshot", () => {
  it("includes files until the token budget is exhausted", () => {
    const snapshot = buildCodebaseSnapshot([
      { path: "package.json", size: 50, content: '{"name":"x"}' },
      { path: "src/a.js", size: 10_000, content: "a".repeat(10_000) },
      { path: "src/b.js", size: 10_000, content: "b".repeat(10_000) },
    ]);
    const budgeted = buildBudgetedSnapshot(snapshot, 3000);
    expect(budgeted.files.length).toBeGreaterThanOrEqual(1);
    expect(estimateTokens(formatSnapshotForLlm(budgeted))).toBeLessThanOrEqual(
      3000,
    );
  });

  it("only includes selected paths when provided", () => {
    const snapshot = buildCodebaseSnapshot([
      { path: "package.json", size: 50, content: '{"name":"x"}' },
      { path: "src/a.js", size: 100, content: "a" },
      { path: "src/b.js", size: 100, content: "b" },
    ]);
    const selected = buildBudgetedSnapshot(
      snapshot,
      100_000,
      new Set(["src/a.js"]),
    );
    expect(selected.files.map((f) => f.path)).toEqual(["src/a.js"]);
  });
});

describe("chunkSnapshot", () => {
  it("places priority files in their own chunk", () => {
    const snapshot = buildCodebaseSnapshot([
      { path: "package.json", size: 50, content: '{"name":"x"}' },
      { path: "src/a.js", size: 10_000, content: "a".repeat(10_000) },
      { path: "src/b.js", size: 10_000, content: "b".repeat(10_000) },
    ]);
    const chunks = chunkSnapshot(snapshot, 3000);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].name).toBe("priority-manifests");
    expect(chunks[0].files.map((f) => f.path)).toContain("package.json");
  });
});

describe("tarball size guard", () => {
  it("rejects tarballs larger than the configured maximum", async () => {
    const { fetchNpmTarball } = await import("./codebase");
    const oversized = new Uint8Array(MAX_TARBALL_BYTES + 1);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(oversized.buffer, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    await expect(
      fetchNpmTarball("https://registry.npmjs.org/fake/-/fake-1.0.0.tgz"),
    ).rejects.toThrow("Tarball is too large");
  });
});
