export interface CodebaseFile {
  path: string;
  size: number;
  content: string;
}

export interface CodebaseSnapshot {
  files: CodebaseFile[];
  fileCount: number;
  totalSize: number;
}

export interface SourceChunk {
  name: string;
  files: CodebaseFile[];
  totalSize: number;
}

const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".github",
  ".vscode",
  ".idea",
  "dist",
  "build",
  "coverage",
  "out",
  "tmp",
  "temp",
  "__pycache__",
  ".next",
  ".nuxt",
  ".cache",
  "test",
  "tests",
  "spec",
  "specs",
  "fixtures",
  "examples",
  "docs",
  "doc",
  "website",
  "site",
]);

const SKIPPED_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".ogg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".br",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".map",
];

// Extraction limits: how much source we pull out of the tarball locally.
// These are bounded by Worker memory and by the LLM context budget below.
export const MAX_FILE_SIZE = 500 * 1024; // 500 KB
export const MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_FILES = 500;

// Network limit: refuse to download enormous tarballs that could OOM a Worker.
export const MAX_TARBALL_BYTES = 20 * 1024 * 1024; // 20 MB

// Rough token estimation for code/text. Code is token-denser than prose,
// so this is intentionally conservative.
export const CHARS_PER_TOKEN_ESTIMATE = 3.0;

// Default LLM context budget the pipeline targets. The source portion is
// kept smaller than this to leave room for system prompts, metadata,
// instructions, and the structured output.
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000;
export const DEFAULT_SOURCE_TOKEN_BUDGET = 200_000;

// Tokens reserved for system prompt, metadata, instructions, JSON schema,
// and the structured output. This is subtracted from the model's context window
// to arrive at the source-code budget.
const PROMPT_OVERHEAD_TOKENS = 50_000;

export function sourceTokenBudget(): number {
  const configured = process.env.LLM_CONTEXT_TOKEN_BUDGET
    ? parseInt(process.env.LLM_CONTEXT_TOKEN_BUDGET, 10)
    : DEFAULT_SOURCE_TOKEN_BUDGET + PROMPT_OVERHEAD_TOKENS;
  if (Number.isNaN(configured) || configured <= 0) {
    return DEFAULT_SOURCE_TOKEN_BUDGET;
  }
  return Math.max(10_000, configured - PROMPT_OVERHEAD_TOKENS);
}

export function shouldSkipFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (SKIPPED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  const parts = path.split("/");
  for (const part of parts) {
    if (SKIPPED_DIRS.has(part)) return true;
  }
  return false;
}

function looksLikeText(content: Uint8Array): boolean {
  // A quick heuristic: reject if too many null bytes or control chars.
  let suspicious = 0;
  const sample = content.slice(0, Math.min(content.length, 1024));
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 && byte !== 0x0a && byte !== 0x0d) suspicious++;
  }
  return suspicious < sample.length * 0.1;
}

function stripRootPrefix(path: string): string {
  const slashIndex = path.indexOf("/");
  if (slashIndex === -1) return path;
  return path.slice(slashIndex + 1);
}

function readOctal(buffer: Uint8Array, start: number, length: number): number {
  let value = 0;
  for (let i = start; i < start + length; i++) {
    const byte = buffer[i];
    if (byte === 0x20 || byte === 0) continue;
    value = value * 8 + (byte - 0x30);
  }
  return value;
}

function readString(buffer: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && buffer[end] !== 0) end++;
  return new TextDecoder().decode(buffer.subarray(start, end));
}

function readUstarName(buffer: Uint8Array, offset: number): string {
  const name = readString(buffer, offset, 100);
  const prefix = readString(buffer, offset + 345, 155);
  if (prefix) return `${prefix}/${name}`;
  return name;
}

function parsePaxAttributes(content: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^\d+\s+([^=]+)=(.*)$/);
    if (match) {
      attrs[match[1]] = match[2];
    }
  }
  return attrs;
}

interface TarHeader {
  name: string;
  size: number;
  type: number;
  isEnd: boolean;
}

function parseTarHeader(
  buffer: Uint8Array,
  offset: number,
): TarHeader | null {
  if (offset + 512 > buffer.length) return null;

  // Two consecutive zero blocks mark the end.
  let allZero = true;
  for (let i = offset; i < offset + 512; i++) {
    if (buffer[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return { name: "", size: 0, type: 0, isEnd: true };

  const typeFlag = buffer[offset + 156];
  const name = readUstarName(buffer, offset);
  const size = readOctal(buffer, offset + 124, 12);

  return { name, size, type: typeFlag, isEnd: false };
}

export function parseTar(buffer: Uint8Array): CodebaseFile[] {
  const files: CodebaseFile[] = [];
  let offset = 0;
  let pendingPaxAttributes: Record<string, string> | null = null;

  while (offset < buffer.length) {
    const header = parseTarHeader(buffer, offset);
    if (!header) break;
    if (header.isEnd) break;

    offset += 512;

    const contentBytes = buffer.subarray(offset, offset + header.size);
    const type = header.type;

    if (type === 0x78 || type === 0x67) {
      // Pax extended header ('x' = file, 'g' = global).
      const text = new TextDecoder().decode(contentBytes);
      pendingPaxAttributes = parsePaxAttributes(text);
    } else if (type === 0x30 || type === 0) {
      // Regular file or old format.
      let path = header.name;
      if (pendingPaxAttributes?.path) {
        path = pendingPaxAttributes.path;
      }
      path = stripRootPrefix(path);

      if (
        path &&
        !shouldSkipFile(path) &&
        header.size <= MAX_FILE_SIZE &&
        looksLikeText(contentBytes)
      ) {
        files.push({
          path,
          size: header.size,
          content: new TextDecoder().decode(contentBytes),
        });
      }
      pendingPaxAttributes = null;
    } else {
      pendingPaxAttributes = null;
    }

    // File contents are padded to 512-byte boundaries.
    offset += Math.ceil(header.size / 512) * 512;
  }

  return files;
}

async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(buffer).body;
  if (!stream) throw new Error("Empty response body.");
  const decompressed = stream.pipeThrough(new DecompressionStream("gzip"));
  const result = await new Response(decompressed).arrayBuffer();
  assertTarballSize(result);
  return result;
}

function assertTarballSize(buffer: ArrayBuffer): void {
  if (buffer.byteLength > MAX_TARBALL_BYTES) {
    throw new Error(
      `Tarball is too large (${Math.round(
        buffer.byteLength / (1024 * 1024),
      )} MB). Max supported is ${MAX_TARBALL_BYTES / (1024 * 1024)} MB.`,
    );
  }
}

function shouldDecompressGzip(
  url: string,
  contentType: string | null,
): boolean {
  if (contentType?.includes("gzip")) return true;
  const lower = url.toLowerCase();
  return lower.endsWith(".tgz") || lower.endsWith(".tar.gz") || lower.endsWith(".gz");
}

export async function fetchNpmTarball(tarballUrl: string): Promise<CodebaseFile[]> {
  const res = await fetch(tarballUrl, {
    headers: { Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch npm tarball: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  const buffer = await res.arrayBuffer();
  assertTarballSize(buffer);
  const decompressed = shouldDecompressGzip(tarballUrl, contentType)
    ? await decompressGzip(buffer)
    : buffer;
  return parseTar(new Uint8Array(decompressed));
}

export async function fetchGitHubTarball(
  owner: string,
  repo: string,
  ref = "HEAD",
): Promise<CodebaseFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "sbomit-audit",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch GitHub tarball: ${res.status} ${res.statusText}`,
    );
  }
  const contentType = res.headers.get("content-type") || "";
  const finalUrl = res.url || url;
  const buffer = await res.arrayBuffer();
  assertTarballSize(buffer);
  const decompressed = shouldDecompressGzip(finalUrl, contentType)
    ? await decompressGzip(buffer)
    : buffer;
  return parseTar(new Uint8Array(decompressed));
}

export function buildCodebaseSnapshot(files: CodebaseFile[]): CodebaseSnapshot {
  // Prioritize smaller, more relevant files; cap total size.
  const prioritized = files
    .filter((f) => f.size > 0)
    .sort((a, b) => {
      // Bring package.json, lockfiles, and source files to the front.
      const aKey =
        /package\.json|package-lock|yarn\.lock|pnpm-lock|bun\.lock/.test(a.path);
      const bKey =
        /package\.json|package-lock|yarn\.lock|pnpm-lock|bun\.lock/.test(b.path);
      if (aKey && !bKey) return -1;
      if (!aKey && bKey) return 1;
      return a.size - b.size;
    });

  const included: CodebaseFile[] = [];
  let totalSize = 0;
  for (const file of prioritized) {
    if (included.length >= MAX_FILES) break;
    if (totalSize + file.size > MAX_TOTAL_SIZE) {
      // Allow the first few critical files to exceed slightly rather than skip everything.
      if (included.length > 10) break;
    }
    included.push(file);
    totalSize += file.size;
  }

  return {
    files: included,
    fileCount: included.length,
    totalSize,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function formatSnapshotForLlm(snapshot: CodebaseSnapshot): string {
  let output = `Codebase snapshot (${snapshot.fileCount} files, ${snapshot.totalSize} bytes)\n\n`;
  for (const file of snapshot.files) {
    output += `--- FILE: ${file.path} (${file.size} bytes) ---\n`;
    output += file.content;
    if (!file.content.endsWith("\n")) output += "\n";
    output += "\n";
  }
  return output;
}

export function formatFileList(files: CodebaseFile[]): string {
  return files.map((f) => `- ${f.path} (${f.size} bytes)`).join("\n");
}

const PRIORITY_FILE_PATTERN =
  /package\.json|package-lock|yarn\.lock|pnpm-lock|bun\.lock|\.lockb|readme|license|changelog|security|\.github\/(workflows|dependabot|codeql)|postinstall|preinstall|install/i;

function isPriorityFile(path: string): boolean {
  return PRIORITY_FILE_PATTERN.test(path);
}

/**
 * Build a "lite" snapshot for oversized codebases. It contains manifest and
 * lifecycle files first, a sample of small source files, plus a complete file
 * listing. The LLM uses this to direct the deep-dive by selecting files.
 */
export function buildLiteSnapshot(snapshot: CodebaseSnapshot): CodebaseSnapshot {
  const priority = snapshot.files.filter((f) => isPriorityFile(f.path));
  const remaining = snapshot.files.filter((f) => !isPriorityFile(f.path));

  // Add a representative sample of small source files so the LLM sees real code.
  const samples = remaining
    .filter((f) => f.size <= 20 * 1024)
    .slice(0, 30);

  const listing = [
    `Full snapshot: ${snapshot.fileCount} files, ${snapshot.totalSize} bytes`,
    `Lite snapshot includes ${priority.length} priority files and ${samples.length} sample files.`,
    "",
    "Complete file listing (selected files are marked with *):",
    ...snapshot.files.map((f) => {
      const selected =
        priority.includes(f) || samples.includes(f) ? " *" : "";
      return `- ${f.path} (${f.size} bytes)${selected}`;
    }),
  ].join("\n");

  const listingFile: CodebaseFile = {
    path: "FILE_LISTING.txt",
    size: listing.length,
    content: listing,
  };

  const liteFiles = [...priority, ...samples, listingFile];
  const liteSize = liteFiles.reduce((sum, f) => sum + f.size, 0);

  return {
    files: liteFiles,
    fileCount: snapshot.fileCount,
    totalSize: liteSize,
  };
}

/**
 * Split a snapshot into chunks that each fit inside a token budget.
 * The first chunk always contains priority files; remaining files are packed
 * greedily. Used when a single prompt cannot hold the entire source tree.
 */
export function chunkSnapshot(
  snapshot: CodebaseSnapshot,
  maxTokensPerChunk: number,
): SourceChunk[] {
  const maxChars = Math.floor(maxTokensPerChunk * CHARS_PER_TOKEN_ESTIMATE);

  const priority = snapshot.files.filter((f) => isPriorityFile(f.path));
  const rest = snapshot.files.filter((f) => !isPriorityFile(f.path));

  const chunks: SourceChunk[] = [];

  if (priority.length > 0) {
    chunks.push({
      name: "priority-manifests",
      files: priority,
      totalSize: priority.reduce((sum, f) => sum + f.size, 0),
    });
  }

  let current: CodebaseFile[] = [];
  let currentSize = 0;
  for (const file of rest) {
    if (currentSize + file.size > maxChars && current.length > 0) {
      chunks.push({
        name: `chunk-${chunks.length}`,
        files: current,
        totalSize: currentSize,
      });
      current = [];
      currentSize = 0;
    }
    current.push(file);
    currentSize += file.size;
  }
  if (current.length > 0) {
    chunks.push({
      name: `chunk-${chunks.length}`,
      files: current,
      totalSize: currentSize,
    });
  }

  return chunks;
}

/**
 * Build a snapshot of selected files that fits within a character budget.
 * Files are included in order until the budget is exhausted.
 */
export function buildBudgetedSnapshot(
  snapshot: CodebaseSnapshot,
  maxTokens: number,
  selectedPaths?: Set<string>,
): CodebaseSnapshot {
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN_ESTIMATE);
  const sourceFiles = selectedPaths
    ? snapshot.files.filter((f) => selectedPaths.has(f.path))
    : snapshot.files;

  const included: CodebaseFile[] = [];
  let totalSize = 0;
  for (const file of sourceFiles) {
    if (totalSize + file.size > maxChars) {
      if (included.length > 0) break;
      // Always include at least one file, even if it exceeds the budget,
      // so the LLM has something to analyze.
    }
    included.push(file);
    totalSize += file.size;
  }

  return {
    files: included,
    fileCount: included.length,
    totalSize,
  };
}

export interface InvestigationArea {
  area: string;
  rationale: string;
  files: string[];
}

export interface DeepDiveFinding {
  area: string;
  file: string;
  issue: string;
  evidence: string;
  severity: "critical" | "high" | "medium" | "low";
}
