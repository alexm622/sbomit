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

const MAX_FILE_SIZE = 100 * 1024; // 100 KB
const MAX_TOTAL_SIZE = 200 * 1024; // 200 KB
const MAX_FILES = 75;

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
  return new Response(decompressed).arrayBuffer();
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
  const decompressed = contentType.includes("gzip")
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
  const buffer = await res.arrayBuffer();
  const decompressed = contentType.includes("gzip")
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
