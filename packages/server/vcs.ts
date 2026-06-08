import {
  type DiffType,
  type GitDiffOptions,
  type VcsProvider,
  createGitProvider,
  createJjProvider,
  createVcsApi,
  resolveInitialDiffType,
} from "@plannotator/shared/vcs-core";
import {
  detectP4Workspace,
  getP4Context,
  getP4FileContentsForDiff,
  runP4Diff,
} from "./p4";
import {
  type PlasticRuntime,
  createPlasticProvider,
} from "@plannotator/shared/plastic-provider";
import { runtime as gitRuntime } from "./git";
import { runtime as jjRuntime } from "./jj";

const p4Provider: VcsProvider = {
  id: "p4",

  async detect(cwd?: string): Promise<boolean> {
    return (await detectP4Workspace(cwd)) !== null;
  },

  ownsDiffType(diffType: string): boolean {
    return diffType === "p4-default" || diffType.startsWith("p4-changelist:");
  },

  getContext: getP4Context,

  runDiff(diffType: DiffType, _defaultBranch: string, cwd?: string, _options?: GitDiffOptions) {
    return runP4Diff(diffType, cwd);
  },

  getFileContents(diffType, _defaultBranch, filePath, _oldPath?, cwd?) {
    return getP4FileContentsForDiff(diffType, filePath, cwd);
  },
};

// --- Plastic SCM (fork) provider ---

/** Bun-specific runtime for shelling out to the `cm` CLI. */
const plasticRuntime: PlasticRuntime = {
  async runCm(
    args: string[],
    options?: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const proc = Bun.spawn(["cm", ...args], {
        cwd: options?.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    } catch {
      // cm not installed or not in PATH — treat as command failure.
      return { stdout: "", stderr: "cm not found", exitCode: 1 };
    }
  },
  async readTextFile(path: string): Promise<string | null> {
    try {
      return await Bun.file(path).text();
    } catch {
      return null;
    }
  },
};

// Plastic is registered FIRST so its namespaced diff types ("pending",
// "last-changeset", "plastic-branch") and .plastic-root detection take
// precedence in the shared registry. Git/jj/p4 behavior is unchanged: a
// non-Plastic workspace never matches plastic.detect()/ownsDiffType().
const api = createVcsApi([
  createPlasticProvider(plasticRuntime),
  createJjProvider(jjRuntime),
  createGitProvider(gitRuntime),
  p4Provider,
]);

export const {
  detectVcs,
  detectManagedVcs,
  getVcsContext,
  detectRemoteDefaultCompareTarget,
  prepareLocalReviewDiff,
  runVcsDiff,
  getVcsFileContentsForDiff,
  canStageFiles,
  stageFile,
  unstageFile,
  resolveVcsCwd,
} = api;

export { resolveInitialDiffType, gitRuntime };

export type {
  DiffOption,
  DiffType,
  GitContext,
  GitDiffOptions,
  VcsProvider,
  VcsSelection,
  WorktreeInfo,
} from "@plannotator/shared/vcs-core";

export {
  JJ_TRUNK_REVSET,
  jjCompareTargetRevset,
  jjLineBaseRevset,
  parseRemoteBookmark,
  parseWorktreeDiffType,
  validateFilePath,
} from "@plannotator/shared/vcs-core";
