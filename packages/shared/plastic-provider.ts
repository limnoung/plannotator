/**
 * Plastic SCM (Unity DevOps Version Control) adapter – implements the
 * VcsProvider interface by shelling out to the `cm` CLI.
 *
 * Plastic has no staging area, so stageFile/unstageFile throw.
 * Diffs are generated manually because `cm diff` only lists file metadata
 * or opens the GUI – it does not produce unified diffs.
 */

import type {
  VcsProvider,
  VcsContext,
  VcsDiffOption,
  VcsDiffResult,
} from "./vcs-provider";

// ---------------------------------------------------------------------------
// Runtime abstraction – callers inject their own exec / fs layer
// ---------------------------------------------------------------------------

export interface PlasticRuntime {
  runCm(
    args: string[],
    options?: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readTextFile(path: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Binary extension list
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  // Unreal / Unity assets
  ".uasset",
  ".umap",
  ".uexp",
  ".ubulk",
  ".upk",
  ".asset",
  ".prefab",
  ".unity",
  ".mat",
  ".controller",
  ".anim",
  ".mesh",
  ".physicmaterial",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tga",
  ".tif",
  ".tiff",
  ".psd",
  ".exr",
  ".hdr",
  ".ico",
  ".svg",
  ".webp",
  // Audio / Video
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".aac",
  ".mp4",
  ".avi",
  ".mov",
  ".wmv",
  ".webm",
  // Compiled / Archives
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".lib",
  ".pdb",
  ".7z",
  ".zip",
  ".rar",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  // Fonts
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  // 3D
  ".fbx",
  ".obj",
  ".blend",
  ".3ds",
  ".dae",
  ".gltf",
  ".glb",
  // Documents
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
]);

function isBinaryPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/** Returns true when the cm diff type field is "B" (binary) */
function isBinaryType(typeField: string): boolean {
  return typeField.toUpperCase() === "B";
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Remove a single trailing empty string produced by splitting content that ends with \n */
function stripTrailingEmpty(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

/** Normalise backslashes to forward slashes */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Strip a workspace root prefix from an absolute path returned by `cm status`.
 * Both paths are normalised to forward slashes before comparison.
 */
function makeRelative(absolutePath: string, workspaceRoot: string): string {
  const norm = normalizePath(absolutePath);
  const root = normalizePath(workspaceRoot).replace(/\/+$/, "");
  if (norm.toLowerCase().startsWith(root.toLowerCase())) {
    return norm.slice(root.length).replace(/^\/+/, "");
  }
  return norm;
}

// ---------------------------------------------------------------------------
// Unified diff generation
// ---------------------------------------------------------------------------

/**
 * Produce a minimal unified diff in the `diff --git` format that the
 * frontend parser expects (splits on `/^diff --git /m`).
 */
export function createUnifiedDiff(
  oldContent: string | null,
  newContent: string | null,
  filePath: string,
  oldFilePath?: string,
): string {
  const aPath = oldFilePath ?? filePath;
  const bPath = filePath;

  // Normalise line endings (CRLF → LF) and strip trailing newline to
  // avoid phantom empty-string elements that skew hunk line counts.
  const oldLines = oldContent != null ? stripTrailingEmpty(oldContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) : [];
  const newLines = newContent != null ? stripTrailingEmpty(newContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) : [];

  const header = `diff --git a/${aPath} b/${bPath}\n`;

  const fromLine =
    oldContent == null ? "--- /dev/null\n" : `--- a/${aPath}\n`;
  const toLine =
    newContent == null ? "+++ /dev/null\n" : `+++ b/${bPath}\n`;

  const hunks = computeHunks(oldLines, newLines);

  if (hunks.length === 0) {
    // No difference – return empty string so caller can skip.
    return "";
  }

  // Join hunks and ensure exactly one trailing newline – extra blank lines
  // at the end confuse @pierre/diffs (it counts them as context lines that
  // don't match the hunk header).
  const body = hunks.join("").replace(/\n+$/, "\n");
  return header + fromLine + toLine + body;
}

/**
 * Groups consecutive changes into hunks with up to 3 lines of context
 * (matching standard unified diff).
 */
function computeHunks(oldLines: string[], newLines: string[]): string[] {
  const CONTEXT = 3;

  interface Edit {
    type: "keep" | "remove" | "add";
    oldIdx: number;
    newIdx: number;
    line: string;
  }

  // Build edit list from LCS.
  const matched = lcs(oldLines, newLines);
  const edits: Edit[] = [];
  let oi = 0;
  let ni = 0;
  let li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < matched.length) {
      const [oe, ne] = matched[li]!;
      while (oi < oe) {
        edits.push({ type: "remove", oldIdx: oi, newIdx: ni, line: oldLines[oi]! });
        oi++;
      }
      while (ni < ne) {
        edits.push({ type: "add", oldIdx: oi, newIdx: ni, line: newLines[ni]! });
        ni++;
      }
      edits.push({ type: "keep", oldIdx: oi, newIdx: ni, line: oldLines[oi]! });
      oi++;
      ni++;
      li++;
    } else {
      while (oi < oldLines.length) {
        edits.push({ type: "remove", oldIdx: oi, newIdx: ni, line: oldLines[oi]! });
        oi++;
      }
      while (ni < newLines.length) {
        edits.push({ type: "add", oldIdx: oi, newIdx: ni, line: newLines[ni]! });
        ni++;
      }
    }
  }

  // Group edits into hunks with context lines.
  interface Hunk {
    edits: Edit[];
  }

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let lastChangeIdx = -Infinity;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (edit.type !== "keep") {
      if (currentHunk === null || i - lastChangeIdx > CONTEXT * 2 + 1) {
        // Start a new hunk – include up to CONTEXT lines before.
        const contextStart = Math.max(0, i - CONTEXT);
        currentHunk = { edits: edits.slice(contextStart, i) };
        hunks.push(currentHunk);
      } else {
        // Extend current hunk to include bridging context.
        const lastInHunk = currentHunk.edits[currentHunk.edits.length - 1];
        const bridgeStart = lastInHunk ? edits.indexOf(lastInHunk) + 1 : i;
        for (let j = bridgeStart; j < i; j++) {
          currentHunk.edits.push(edits[j]!);
        }
      }
      currentHunk!.edits.push(edit);
      lastChangeIdx = i;
    } else if (currentHunk !== null && i - lastChangeIdx <= CONTEXT) {
      // Trailing context.
      currentHunk.edits.push(edit);
    }
  }

  // Render hunks.  Build the body first, then derive counts from actual
  // output so the header is always consistent with what follows.
  const result: string[] = [];

  for (const hunk of hunks) {
    if (hunk.edits.length === 0) continue;

    // Track 1-based line numbers by scanning edits.
    let oldStart = -1;
    let newStart = -1;
    let oldCount = 0;
    let newCount = 0;
    let body = "";

    for (const e of hunk.edits) {
      if (e.type === "keep" || e.type === "remove") {
        if (oldStart === -1) oldStart = e.oldIdx + 1;
        oldCount++;
      }
      if (e.type === "keep" || e.type === "add") {
        if (newStart === -1) newStart = e.newIdx + 1;
        newCount++;
      }
      const prefix = e.type === "keep" ? " " : e.type === "remove" ? "-" : "+";
      body += `${prefix}${e.line}\n`;
    }

    if (oldStart === -1) oldStart = 0;
    if (newStart === -1) newStart = 0;

    const hunkHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
    result.push(hunkHeader + body);
  }

  return result;
}

/**
 * Basic LCS returning matched index pairs. Uses O(n*m) DP – acceptable for
 * review-sized files but not for multi-MB blobs.
 */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;

  // For very large files, bail out with a greedy approach to avoid memory issues.
  if (n * m > 10_000_000) {
    return simpleLcs(a, b);
  }

  // Build DP table.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  // Backtrack.
  const result: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}

/**
 * Fallback greedy forward-match for very large files – O(n+m).
 */
function simpleLcs(a: string[], b: string[]): [number, number][] {
  const result: [number, number][] = [];
  const bMap = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const line = b[j]!;
    let arr = bMap.get(line);
    if (!arr) {
      arr = [];
      bMap.set(line, arr);
    }
    arr.push(j);
  }

  let lastJ = -1;
  for (let i = 0; i < a.length; i++) {
    const candidates = bMap.get(a[i]!);
    if (!candidates) continue;
    for (const j of candidates) {
      if (j > lastJ) {
        result.push([i, j]);
        lastJ = j;
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Status / diff output parsing
// ---------------------------------------------------------------------------

interface StatusHeader {
  changesetId: string;
  repo: string;
  server: string;
}

interface StatusEntry {
  /** CO, PR, AD, DE, MV, LD, LM */
  status: string;
  /** Absolute path on disk */
  absolutePath: string;
}

function parseStatusOutput(
  stdout: string,
): { header: StatusHeader | null; entries: StatusEntry[] } {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let header: StatusHeader | null = null;
  const entries: StatusEntry[] = [];

  for (const line of lines) {
    const parts = line.split("|");
    if (parts[0] === "STATUS" && parts.length >= 4) {
      header = {
        changesetId: parts[1]!,
        repo: parts[2]!,
        server: parts[3]!,
      };
      continue;
    }
    // Status codes are 2-3 chars (CO, PR, AD, DE, MV, LD, LM)
    if (parts.length >= 2 && /^[A-Z]{2,3}$/.test(parts[0]!)) {
      entries.push({
        status: parts[0]!,
        absolutePath: parts[1]!,
      });
    }
  }

  return { header, entries };
}

interface DiffEntry {
  path: string;
  /** C=Changed, A=Added, D=Deleted, M=Moved */
  status: string;
  /** B=Binary, F=Text, D=Directory */
  type: string;
  revId: string;
  baseRevId: string;
}

function parseDiffOutput(stdout: string): DiffEntry[] {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: DiffEntry[] = [];
  for (const line of lines) {
    // Path may be quoted: "Arc\Content\...\file.uasset"|C|B|1312630|1312472
    const match = line.match(
      /^"?([^"|]+)"?\|([CADM])\|([BFD])\|(-?\d+)\|(-?\d+)$/,
    );
    if (match) {
      entries.push({
        path: match[1]!,
        status: match[2]!,
        type: match[3]!,
        revId: match[4]!,
        baseRevId: match[5]!,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createPlasticProvider(runtime: PlasticRuntime): VcsProvider {
  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  async function runCmOrThrow(args: string[], cwd?: string): Promise<string> {
    const { stdout, stderr, exitCode } = await runtime.runCm(args, { cwd });
    if (exitCode !== 0) {
      throw new Error(
        `cm ${args[0]} failed (exit ${exitCode}): ${stderr || stdout}`,
      );
    }
    return stdout;
  }

  /**
   * Get the workspace root so we can strip it from absolute paths returned
   * by `cm status`.
   */
  async function getWorkspaceRoot(cwd?: string): Promise<string> {
    const out = await runCmOrThrow(["getworkspacefrompath", "."], cwd);
    // Output format: "WorkspaceName c:\Path\To\Workspace MACHINE  guid"
    // Extract the path (second space-separated token that looks like a path)
    const parts = out.trim().split(/\s+/);
    for (const part of parts) {
      // Look for a path-like token (contains : or / or \)
      if (/^[a-zA-Z]:/.test(part) || part.startsWith("/")) {
        return part;
      }
    }
    // Fallback: use cwd
    return cwd || process.cwd();
  }

  /** Read text content of a file via `cm cat`. Returns null on failure. */
  async function cmCat(spec: string, cwd?: string): Promise<string | null> {
    try {
      const { stdout, exitCode } = await runtime.runCm(["cat", spec], { cwd });
      if (exitCode !== 0) return null;
      return stdout;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Diff builders
  // ------------------------------------------------------------------

  /** Build a diff patch for the "pending" changes. */
  async function diffPending(cwd?: string): Promise<VcsDiffResult> {
    const statusOut = await runCmOrThrow(
      ["status", "--machinereadable", "--fieldseparator=|"],
      cwd,
    );
    const { header, entries } = parseStatusOutput(statusOut);

    if (entries.length === 0) {
      return { patch: "", label: "Pending changes (none)" };
    }

    const workspaceRoot = await getWorkspaceRoot(cwd);
    const csId = header?.changesetId ?? "0";
    const patches: string[] = [];

    for (const entry of entries) {
      const relPath = normalizePath(
        makeRelative(entry.absolutePath, workspaceRoot),
      );

      if (isBinaryPath(relPath) || entry.status === "LD") {
        patches.push(
          `diff --git a/${relPath} b/${relPath}\nBinary files differ\n`,
        );
        continue;
      }

      let oldContent: string | null = null;
      let newContent: string | null = null;

      switch (entry.status) {
        case "CO": // Checked out (modified)
        case "CH": // Changed (modified without explicit checkout)
        case "AD": // Added (explicitly)
        case "LM": // Locally moved
        case "MV": {
          oldContent = await cmCat(
            `serverpath:/${relPath}#cs:${csId}`,
            cwd,
          );
          newContent = await runtime.readTextFile(entry.absolutePath);
          break;
        }
        case "PR": {
          // Private (new / untracked) – no old content.
          oldContent = null;
          newContent = await runtime.readTextFile(entry.absolutePath);
          break;
        }
        case "DE":
        case "LD": {
          // Deleted – old from server, no new.
          oldContent = await cmCat(
            `serverpath:/${relPath}#cs:${csId}`,
            cwd,
          );
          newContent = null;
          break;
        }
        default: {
          newContent = await runtime.readTextFile(entry.absolutePath);
          break;
        }
      }

      const patch = createUnifiedDiff(oldContent, newContent, relPath);
      if (patch) patches.push(patch);
    }

    return { patch: patches.join(""), label: "Pending changes" };
  }

  /** Build a diff patch for the last changeset vs its parent. */
  async function diffLastChangeset(cwd?: string): Promise<VcsDiffResult> {
    const statusOut = await runCmOrThrow(
      ["status", "--machinereadable", "--fieldseparator=|"],
      cwd,
    );
    const { header } = parseStatusOutput(statusOut);
    const currentCs = header?.changesetId;
    if (!currentCs) {
      return {
        patch: "",
        label: "Last changeset",
        error: "Could not determine current changeset",
      };
    }

    // Find the parent changeset via cm find.
    const findOut = await runCmOrThrow(
      [
        "find",
        "changeset",
        `where changesetid=${currentCs}`,
        "--format={parent}",
        "--nototal",
      ],
      cwd,
    );
    const prevCs = findOut.trim();
    if (!prevCs || prevCs === "-1") {
      return {
        patch: "",
        label: "Last changeset",
        error: "No parent changeset found",
      };
    }

    const diffOut = await runCmOrThrow(
      [
        "diff",
        `cs:${prevCs}`,
        `cs:${currentCs}`,
        "--format={path}|{status}|{type}|{revid}|{baserevid}",
      ],
      cwd,
    );

    const diffEntries = parseDiffOutput(diffOut);
    if (diffEntries.length === 0) {
      return { patch: "", label: `Changeset ${currentCs} (no changes)` };
    }

    const patches: string[] = [];
    for (const entry of diffEntries) {
      const relPath = normalizePath(entry.path);

      if (isBinaryType(entry.type) || isBinaryPath(relPath)) {
        patches.push(
          `diff --git a/${relPath} b/${relPath}\nBinary files differ\n`,
        );
        continue;
      }

      let oldContent: string | null = null;
      let newContent: string | null = null;

      if (entry.status !== "A") {
        oldContent = await cmCat(`serverpath:/${relPath}#cs:${prevCs}`, cwd);
      }
      if (entry.status !== "D") {
        newContent = await cmCat(
          `serverpath:/${relPath}#cs:${currentCs}`,
          cwd,
        );
      }

      const patch = createUnifiedDiff(oldContent, newContent, relPath);
      if (patch) patches.push(patch);
    }

    return {
      patch: patches.join(""),
      label: `Changeset ${currentCs} vs ${prevCs}`,
    };
  }

  /** Build a diff patch for current branch vs default branch. */
  async function diffBranch(
    defaultBranch: string,
    cwd?: string,
  ): Promise<VcsDiffResult> {
    const branchSpec = defaultBranch.startsWith("/")
      ? `br:${defaultBranch}`
      : `br:/${defaultBranch}`;

    const diffOut = await runCmOrThrow(
      [
        "diff",
        branchSpec,
        "--format={path}|{status}|{type}|{revid}|{baserevid}",
      ],
      cwd,
    );

    const diffEntries = parseDiffOutput(diffOut);
    if (diffEntries.length === 0) {
      return { patch: "", label: `Branch vs ${defaultBranch} (no changes)` };
    }

    const patches: string[] = [];
    for (const entry of diffEntries) {
      const relPath = normalizePath(entry.path);

      if (isBinaryType(entry.type) || isBinaryPath(relPath)) {
        patches.push(
          `diff --git a/${relPath} b/${relPath}\nBinary files differ\n`,
        );
        continue;
      }

      let oldContent: string | null = null;
      let newContent: string | null = null;

      if (entry.status !== "A") {
        oldContent = await cmCat(
          `serverpath:/${relPath}#${branchSpec}`,
          cwd,
        );
      }
      if (entry.status !== "D") {
        // New side: try reading from HEAD changeset, then fall back to working copy.
        newContent = await cmCat(`serverpath:/${relPath}#cs:LATEST`, cwd);
        if (newContent == null) {
          const workspaceRoot = await getWorkspaceRoot(cwd);
          const absPath = `${normalizePath(workspaceRoot)}/${relPath}`;
          newContent = await runtime.readTextFile(absPath);
        }
      }

      const patch = createUnifiedDiff(oldContent, newContent, relPath);
      if (patch) patches.push(patch);
    }

    return { patch: patches.join(""), label: `Branch vs ${defaultBranch}` };
  }

  // ------------------------------------------------------------------
  // VcsProvider implementation
  // ------------------------------------------------------------------

  return {
    type: "plastic",
    supportsStaging: false,

    async getContext(cwd?: string): Promise<VcsContext> {
      // Parse current branch from `cm wi`.
      // Example: "Branch /main@Cloud Repositories/ProjectArc@ArcTeam@unity"
      const wiOut = await runCmOrThrow(["wi"], cwd);
      const branchMatch = wiOut.match(/^Branch\s+(\S+?)@/m);
      const currentBranch = branchMatch ? branchMatch[1]! : "/main";

      // Determine default branch.
      let defaultBranch = "/main";
      try {
        const findOut = await runCmOrThrow(
          [
            "find",
            "branch",
            "where name='main'",
            "--format={name}",
            "--nototal",
          ],
          cwd,
        );
        const found = findOut.trim().split("\n").filter(Boolean);
        if (found.length > 0 && found[0]!.startsWith("/")) {
          defaultBranch = found[0]!;
        }
      } catch {
        // Keep default /main.
      }

      const diffOptions: VcsDiffOption[] = [
        { id: "pending", label: "Pending changes" },
        { id: "last-changeset", label: "Last changeset" },
      ];

      if (currentBranch !== defaultBranch) {
        diffOptions.push({
          id: "branch",
          label: `Branch vs ${defaultBranch}`,
        });
      }

      return {
        vcsType: "plastic",
        currentBranch,
        defaultBranch,
        diffOptions,
        cwd,
        supportsStaging: false,
      };
    },

    async getDiff(
      diffType: string,
      defaultBranch: string,
      cwd?: string,
    ): Promise<VcsDiffResult> {
      try {
        switch (diffType) {
          case "pending":
            return await diffPending(cwd);
          case "last-changeset":
            return await diffLastChangeset(cwd);
          case "branch":
            return await diffBranch(defaultBranch, cwd);
          default:
            return {
              patch: "",
              label: diffType,
              error: `Unknown diff type: ${diffType}`,
            };
        }
      } catch (err) {
        return {
          patch: "",
          label: diffType,
          error:
            err instanceof Error
              ? err.message
              : `Failed to get diff: ${String(err)}`,
        };
      }
    },

    async getDiffWithContext(
      diffType: string,
      context: VcsContext,
    ): Promise<VcsDiffResult> {
      return this.getDiff(diffType, context.defaultBranch, context.cwd);
    },

    async getFileContents(
      diffType: string,
      defaultBranch: string,
      filePath: string,
      _oldPath?: string,
      cwd?: string,
    ): Promise<{ oldContent: string | null; newContent: string | null }> {
      this.validateFilePath(filePath);
      const normalizedPath = normalizePath(filePath);

      try {
        switch (diffType) {
          case "pending": {
            const statusOut = await runCmOrThrow(
              ["status", "--machinereadable", "--fieldseparator=|"],
              cwd,
            );
            const { header } = parseStatusOutput(statusOut);
            const csId = header?.changesetId ?? "0";
            const workspaceRoot = await getWorkspaceRoot(cwd);

            const oldContent = await cmCat(
              `serverpath:/${normalizedPath}#cs:${csId}`,
              cwd,
            );
            const absPath = `${normalizePath(workspaceRoot)}/${normalizedPath}`;
            const newContent = await runtime.readTextFile(absPath);
            return { oldContent, newContent };
          }
          case "last-changeset": {
            const statusOut = await runCmOrThrow(
              ["status", "--machinereadable", "--fieldseparator=|"],
              cwd,
            );
            const { header } = parseStatusOutput(statusOut);
            const currentCs = header?.changesetId;
            if (!currentCs) {
              return { oldContent: null, newContent: null };
            }

            const findOut = await runCmOrThrow(
              [
                "find",
                "changeset",
                `where changesetid=${currentCs}`,
                "--format={parent}",
                "--nototal",
              ],
              cwd,
            );
            const prevCs = findOut.trim() && findOut.trim() !== "-1" ? findOut.trim() : currentCs;

            const oldContent = await cmCat(
              `serverpath:/${normalizedPath}#cs:${prevCs}`,
              cwd,
            );
            const newContent = await cmCat(
              `serverpath:/${normalizedPath}#cs:${currentCs}`,
              cwd,
            );
            return { oldContent, newContent };
          }
          case "branch": {
            const branchSpec = defaultBranch.startsWith("/")
              ? `br:${defaultBranch}`
              : `br:/${defaultBranch}`;

            const oldContent = await cmCat(
              `serverpath:/${normalizedPath}#${branchSpec}`,
              cwd,
            );

            const workspaceRoot = await getWorkspaceRoot(cwd);
            const absPath = `${normalizePath(workspaceRoot)}/${normalizedPath}`;
            const newContent = await runtime.readTextFile(absPath);
            return { oldContent, newContent };
          }
          default:
            return { oldContent: null, newContent: null };
        }
      } catch {
        return { oldContent: null, newContent: null };
      }
    },

    async stageFile(_filePath: string, _cwd?: string): Promise<void> {
      throw new Error("Plastic SCM does not support staging");
    },

    async unstageFile(_filePath: string, _cwd?: string): Promise<void> {
      throw new Error("Plastic SCM does not support staging");
    },

    validateFilePath(filePath: string): void {
      if (filePath.includes("..") || filePath.startsWith("/")) {
        throw new Error("Invalid file path");
      }
    },
  };
}
